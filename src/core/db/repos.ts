// Typed read/write helpers, one per table. Every write goes through here.
//
// A write that is not already inside a batch opens its own transaction and notifies the
// subscribers after it commits. `repos.transaction()` groups several writes into one
// atomic batch: either all of them are stored and subscribers hear about it once, or none
// are stored and nobody is notified.
//
// Inside a batch, await only repo calls. Awaiting anything else (fetch, crypto.subtle,
// timers) lets IndexedDB commit the transaction early. Do that work before the batch.
import Dexie, { type Table } from 'dexie';
import type {
  DocumentRecord,
  ID,
  Medicine,
  MedicationEvent,
  MedicineStatus,
  PrescriptionLine,
  Prescriber,
  Profile,
  ReviewItem,
  Visit,
} from '../../contract/legacy/types';
import type { ChangeNotifier } from './events';
import type { CareVaultDb, SettingRow, StoredFile, StoredShare } from './schema';

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

export interface Repos {
  db: CareVaultDb;
  /** Runs `fn` as one atomic batch over every table and notifies subscribers once. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  profiles: CrudRepo<Profile>;
  prescribers: CrudRepo<Prescriber> & {
    byProfile(profileId: ID): Promise<Prescriber[]>;
  };
  medicines: CrudRepo<Medicine> & {
    byProfile(profileId: ID): Promise<Medicine[]>;
    byStatus(profileId: ID, status: MedicineStatus): Promise<Medicine[]>;
  };
  events: CrudRepo<MedicationEvent> & {
    /** Oldest first. */
    byProfile(profileId: ID): Promise<MedicationEvent[]>;
    /** Oldest first. */
    byMedicine(medicineId: ID): Promise<MedicationEvent[]>;
  };
  documents: CrudRepo<DocumentRecord> & {
    byProfile(profileId: ID): Promise<DocumentRecord[]>;
    /** Documents of this profile whose file has exactly this hash. */
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
    byDocument(documentId: ID): Promise<PrescriptionLine[]>;
    byDocuments(documentIds: readonly ID[]): Promise<PrescriptionLine[]>;
    deleteByDocument(documentId: ID): Promise<void>;
  };
  reviewItems: CrudRepo<ReviewItem> & {
    byProfile(profileId: ID): Promise<ReviewItem[]>;
    /** Unresolved items, oldest first. */
    openByProfile(profileId: ID): Promise<ReviewItem[]>;
  };
  visits: CrudRepo<Visit> & {
    /** Earliest first. */
    byProfile(profileId: ID): Promise<Visit[]>;
  };
  shares: CrudRepo<StoredShare>;
  settings: {
    get<V>(key: string): Promise<V | undefined>;
    all(): Promise<SettingRow[]>;
    set(key: string, value: unknown): Promise<void>;
    bulkPut(rows: readonly SettingRow[]): Promise<void>;
  };
  /** Empties every table in one batch. Used by backup import. */
  clearAll(): Promise<void>;
}

export function createRepos(db: CareVaultDb, notifier: ChangeNotifier): Repos {
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
          await table.bulkPut(rows);
        }),
      delete: (id) => write(() => table.delete(id)),
      bulkDelete: (ids) => write(() => table.bulkDelete([...ids])),
    };
  }

  return {
    db,
    transaction: write,

    profiles: crud(db.profiles),

    prescribers: {
      ...crud(db.prescribers),
      byProfile: (profileId) => db.prescribers.where('profileId').equals(profileId).toArray(),
    },

    medicines: {
      ...crud(db.medicines),
      byProfile: (profileId) => db.medicines.where('profileId').equals(profileId).toArray(),
      byStatus: (profileId, status) =>
        db.medicines.where('[profileId+status]').equals([profileId, status]).toArray(),
    },

    events: {
      ...crud(db.events),
      byProfile: async (profileId) =>
        (await db.events.where('profileId').equals(profileId).toArray()).sort(byTime((e) => e.at)),
      byMedicine: async (medicineId) =>
        (await db.events.where('medicineId').equals(medicineId).toArray()).sort(byTime((e) => e.at)),
    },

    documents: {
      ...crud(db.documents),
      byProfile: (profileId) => db.documents.where('profileId').equals(profileId).toArray(),
      bySha256: async (profileId, sha256) =>
        (await db.documents.where('sha256').equals(sha256).toArray()).filter(
          (d) => d.profileId === profileId,
        ),
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
          await db.files.bulkPut(rows);
        }),
      delete: (documentId) => write(() => db.files.delete(documentId)),
    },

    prescriptionLines: {
      ...crud(db.prescriptionLines),
      byDocument: (documentId) =>
        db.prescriptionLines.where('documentId').equals(documentId).toArray(),
      byDocuments: (documentIds) =>
        db.prescriptionLines.where('documentId').anyOf([...documentIds]).toArray(),
      deleteByDocument: (documentId) =>
        write(async () => {
          await db.prescriptionLines.where('documentId').equals(documentId).delete();
        }),
    },

    reviewItems: {
      ...crud(db.reviewItems),
      byProfile: (profileId) => db.reviewItems.where('profileId').equals(profileId).toArray(),
      openByProfile: async (profileId) =>
        (await db.reviewItems.where('profileId').equals(profileId).toArray())
          .filter((item) => item.resolvedAt === null)
          .sort(byTime((item) => item.createdAt)),
    },

    visits: {
      ...crud(db.visits),
      byProfile: async (profileId) =>
        (await db.visits.where('profileId').equals(profileId).toArray()).sort(byTime((v) => v.at)),
    },

    shares: crud(db.shares),

    settings: {
      get: async <V>(key: string) => (await db.settings.get(key))?.value as V | undefined,
      all: () => db.settings.toArray(),
      set: (key, value) =>
        write(async () => {
          await db.settings.put({ key, value });
        }),
      bulkPut: (rows) =>
        write(async () => {
          await db.settings.bulkPut(rows);
        }),
    },

    clearAll: () =>
      write(async () => {
        await Promise.all(db.tables.map((table) => table.clear()));
      }),
  };
}
