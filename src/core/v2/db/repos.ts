// Typed read/write helpers for the v2 tables. Every write goes through here.
//
// A write that is not already inside a batch opens its own transaction and notifies the
// subscribers after it commits. `repos.transaction()` groups several writes into one atomic
// batch: either all of them are stored and subscribers hear about it once, or none are
// stored and nobody is notified.
//
// Inside a batch, await only repo calls. Awaiting anything else (fetch, crypto.subtle,
// timers) lets IndexedDB commit the transaction early. Do that work before the batch.
import Dexie, { type Table } from 'dexie';
import type {
  DocumentRecord,
  FieldEvidence,
  HealthEntry,
  ID,
  PassportSnapshot,
  PrescriptionLine,
  Prescriber,
  Profile,
  RoutineEvent,
  RoutineMedicine,
  RoutineProposal,
  RoutineStatus,
  Visit,
} from '../../../contract/types';
import type { ChangeNotifier } from '../../db/events';
import type { CareVaultDbV2, GmailImport, SettingRow, StoredFile, StoredShareV2 } from './schema';

/** Chronological order for ISO date-times that may carry different UTC offsets. */
export function byTime<T>(pick: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => Date.parse(pick(a)) - Date.parse(pick(b));
}

export interface CrudRepo<T> {
  get(id: ID): Promise<T | undefined>;
  all(): Promise<T[]>;
  put(row: T): Promise<T>;
  bulkPut(rows: readonly T[]): Promise<void>;
  delete(id: ID): Promise<void>;
  bulkDelete(ids: readonly ID[]): Promise<void>;
}

type ProfileScoped<T> = CrudRepo<T> & { byProfile(profileId: ID): Promise<T[]> };

export interface ReposV2 {
  db: CareVaultDbV2;
  /** Runs `fn` as one atomic batch over every table and notifies subscribers once. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  profiles: CrudRepo<Profile>;
  prescribers: ProfileScoped<Prescriber>;
  documents: ProfileScoped<DocumentRecord> & {
    /** Documents of this profile whose file has exactly this hash, from any source. */
    bySha256(profileId: ID, sha256: string): Promise<DocumentRecord[]>;
  };
  files: {
    get(documentId: ID): Promise<Blob | undefined>;
    all(): Promise<StoredFile[]>;
    put(documentId: ID, blob: Blob): Promise<void>;
    bulkPut(rows: readonly StoredFile[]): Promise<void>;
    delete(documentId: ID): Promise<void>;
  };
  prescriptionLines: CrudRepo<PrescriptionLine> & {
    /** In line order. */
    byDocument(documentId: ID): Promise<PrescriptionLine[]>;
    byDocuments(documentIds: readonly ID[]): Promise<PrescriptionLine[]>;
    deleteByDocument(documentId: ID): Promise<void>;
  };
  fieldEvidence: ProfileScoped<FieldEvidence> & {
    byDocument(documentId: ID): Promise<FieldEvidence[]>;
    deleteByDocument(documentId: ID): Promise<void>;
  };
  routine: ProfileScoped<RoutineMedicine> & {
    byStatus(profileId: ID, status: RoutineStatus): Promise<RoutineMedicine[]>;
  };
  routineEvents: CrudRepo<RoutineEvent> & {
    /** Oldest first. */
    byProfile(profileId: ID): Promise<RoutineEvent[]>;
    /** Oldest first. */
    byMedicine(medicineId: ID): Promise<RoutineEvent[]>;
  };
  healthEntries: ProfileScoped<HealthEntry>;
  proposals: ProfileScoped<RoutineProposal> & {
    byDocument(documentId: ID): Promise<RoutineProposal[]>;
  };
  snapshots: CrudRepo<PassportSnapshot> & {
    /** Newest revision first. */
    byProfile(profileId: ID): Promise<PassportSnapshot[]>;
  };
  visits: CrudRepo<Visit> & {
    /** Earliest first. */
    byProfile(profileId: ID): Promise<Visit[]>;
  };
  shares: ProfileScoped<StoredShareV2> & {
    /** v1 links whose owner cannot be proven. */
    unowned(): Promise<StoredShareV2[]>;
  };
  gmailImports: {
    get(profileId: ID, messageId: string, attachmentId: string): Promise<GmailImport | undefined>;
    byProfile(profileId: ID): Promise<GmailImport[]>;
    all(): Promise<GmailImport[]>;
    put(row: GmailImport): Promise<void>;
    bulkPut(rows: readonly GmailImport[]): Promise<void>;
  };
  settings: {
    get<V>(key: string): Promise<V | undefined>;
    all(): Promise<SettingRow[]>;
    set(key: string, value: unknown): Promise<void>;
    bulkPut(rows: readonly SettingRow[]): Promise<void>;
  };
  /** The per-profile routine revision. Increases with every routine write. */
  routineRevision: {
    get(profileId: ID): Promise<number>;
    /** Increments and returns the new revision. Call it inside the batch that writes the routine. */
    bump(profileId: ID): Promise<number>;
  };
  /** Empties every table in one batch. Used by backup import. */
  clearAll(): Promise<void>;
}

export const revisionKey = (profileId: ID) => `routineRevision:${profileId}`;

export function createReposV2(db: CareVaultDbV2, notifier: ChangeNotifier): ReposV2 {
  async function write<T>(fn: () => Promise<T>): Promise<T> {
    // Already inside a batch: join it. The outermost batch notifies after it commits.
    if (Dexie.currentTransaction) return fn();
    const result = await db.transaction('rw', db.tables, fn);
    notifier.notify();
    return result;
  }

  function crud<T extends { id: ID }>(table: Table<T, ID>): CrudRepo<T> {
    return {
      get: (id) => table.get(id),
      all: () => table.toArray(),
      put: (row) =>
        write(async () => {
          await table.put(row);
          return row;
        }),
      bulkPut: (rows) =>
        write(async () => {
          await table.bulkPut([...rows]);
        }),
      delete: (id) => write(() => table.delete(id)),
      bulkDelete: (ids) => write(() => table.bulkDelete([...ids])),
    };
  }

  function scoped<T extends { id: ID; profileId: ID | null }>(table: Table<T, ID>): ProfileScoped<T> {
    return { ...crud(table), byProfile: (profileId) => table.where('profileId').equals(profileId).toArray() };
  }

  const settingsGet = async <V>(key: string) => (await db.settings.get(key))?.value as V | undefined;

  return {
    db,
    transaction: write,

    profiles: crud(db.profiles),
    prescribers: scoped(db.prescribers),

    documents: {
      ...scoped(db.documents),
      bySha256: (profileId, sha256) => db.documents.where('[profileId+sha256]').equals([profileId, sha256]).toArray(),
    },

    files: {
      get: async (documentId) => (await db.files.get(documentId))?.blob,
      all: () => db.files.toArray(),
      put: (documentId, blob) =>
        write(async () => {
          await db.files.put({ id: documentId, blob });
        }),
      bulkPut: (rows) =>
        write(async () => {
          await db.files.bulkPut([...rows]);
        }),
      delete: (documentId) => write(() => db.files.delete(documentId)),
    },

    prescriptionLines: {
      ...crud(db.prescriptionLines),
      byDocument: async (documentId) =>
        (await db.prescriptionLines.where('documentId').equals(documentId).toArray()).sort((a, b) => a.lineIndex - b.lineIndex),
      byDocuments: (documentIds) => db.prescriptionLines.where('documentId').anyOf([...documentIds]).toArray(),
      deleteByDocument: (documentId) =>
        write(async () => {
          await db.prescriptionLines.where('documentId').equals(documentId).delete();
        }),
    },

    fieldEvidence: {
      ...scoped(db.fieldEvidence),
      byDocument: (documentId) => db.fieldEvidence.where('documentId').equals(documentId).toArray(),
      deleteByDocument: (documentId) =>
        write(async () => {
          await db.fieldEvidence.where('documentId').equals(documentId).delete();
        }),
    },

    routine: {
      ...scoped(db.routine),
      byStatus: (profileId, status) => db.routine.where('[profileId+status]').equals([profileId, status]).toArray(),
    },

    routineEvents: {
      ...crud(db.routineEvents),
      byProfile: async (profileId) =>
        (await db.routineEvents.where('profileId').equals(profileId).toArray()).sort(byTime((e) => e.at)),
      byMedicine: async (medicineId) =>
        (await db.routineEvents.where('medicineId').equals(medicineId).toArray()).sort(byTime((e) => e.at)),
    },

    healthEntries: scoped(db.healthEntries),

    proposals: {
      ...scoped(db.proposals),
      byDocument: (documentId) => db.proposals.where('documentId').equals(documentId).toArray(),
    },

    snapshots: {
      ...crud(db.snapshots),
      byProfile: async (profileId) =>
        (await db.snapshots.where('profileId').equals(profileId).toArray()).sort((a, b) => b.revision - a.revision),
    },

    visits: {
      ...crud(db.visits),
      byProfile: async (profileId) =>
        (await db.visits.where('profileId').equals(profileId).toArray()).sort(byTime((v) => v.at)),
    },

    shares: {
      ...scoped(db.shares),
      // IndexedDB does not index null, so unowned links are found by filtering.
      unowned: async () => (await db.shares.toArray()).filter((s) => s.profileId === null),
    },

    gmailImports: {
      get: (profileId, messageId, attachmentId) => db.gmailImports.get([profileId, messageId, attachmentId]),
      byProfile: (profileId) => db.gmailImports.where('profileId').equals(profileId).toArray(),
      all: () => db.gmailImports.toArray(),
      put: (row) =>
        write(async () => {
          await db.gmailImports.put(row);
        }),
      bulkPut: (rows) =>
        write(async () => {
          await db.gmailImports.bulkPut([...rows]);
        }),
    },

    settings: {
      get: settingsGet,
      all: () => db.settings.toArray(),
      set: (key, value) =>
        write(async () => {
          await db.settings.put({ key, value });
        }),
      bulkPut: (rows) =>
        write(async () => {
          await db.settings.bulkPut([...rows]);
        }),
    },

    routineRevision: {
      get: async (profileId) => (await settingsGet<number>(revisionKey(profileId))) ?? 0,
      bump: (profileId) =>
        write(async () => {
          const next = ((await settingsGet<number>(revisionKey(profileId))) ?? 0) + 1;
          await db.settings.put({ key: revisionKey(profileId), value: next });
          return next;
        }),
    },

    clearAll: () =>
      write(async () => {
        await Promise.all(db.tables.map((table) => table.clear()));
      }),
  };
}
