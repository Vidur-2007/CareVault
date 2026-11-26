// The local database, v2. Same database name as v1 ('carevault'), so a device that used v1
// is upgraded in place:
//   version 1  the v1 schema, unchanged (declared so Dexie can upgrade from it)
//   version 2  adds the v2 tables, re-indexes documents and shares, and maps every v1 row
//              to v2 with migrateV1 while the v1 tables still exist
//   version 3  removes the v1-only tables (medicines, events, reviewItems)
// During the v2 build the v1 app still opens 'carevault' at version 1. Never point the v1 app
// and real v2 services at the same browser profile: once upgraded, v1 cannot open it again.
import Dexie, { type Table, type Transaction } from 'dexie';
import type * as L from '../../../contract/legacy/types';
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
  ShareLink,
  Visit,
} from '../../../contract/types';
import { migrateV1, type StoredShareV1, type V1Tables } from './migrate';

export const DB_NAME = 'carevault';

export interface StoredFile {
  id: ID;
  blob: Blob;
}

/** A share link plus the secret needed to revoke it. The secret never leaves this table. */
export interface StoredShareV2 extends ShareLink {
  revokeToken: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** One imported Gmail attachment, per profile. */
export interface GmailImport {
  profileId: ID;
  messageId: string;
  attachmentId: string;
  documentId: ID;
  importedAt: string;
}

export const V1_STORES = {
  profiles: 'id',
  prescribers: 'id, profileId',
  medicines: 'id, profileId, [profileId+status]',
  events: 'id, profileId, medicineId, at',
  documents: 'id, profileId, sha256, documentDate',
  files: 'id',
  prescriptionLines: 'id, documentId',
  reviewItems: 'id, profileId, resolvedAt',
  visits: 'id, profileId, at',
  shares: 'id',
  settings: 'key',
} as const;

export const V2_STORES = {
  profiles: 'id',
  prescribers: 'id, profileId',
  documents: 'id, profileId, [profileId+sha256], clinicalDate',
  files: 'id',
  prescriptionLines: 'id, documentId',
  fieldEvidence: 'id, profileId, documentId',
  routine: 'id, profileId, [profileId+status]',
  routineEvents: 'id, profileId, medicineId, at',
  healthEntries: 'id, profileId',
  proposals: 'id, profileId, documentId',
  snapshots: 'id, profileId',
  visits: 'id, profileId, at',
  shares: 'id, profileId',
  gmailImports: '[profileId+messageId+attachmentId], profileId, documentId',
  settings: 'key',
} as const;

export const TABLE_NAMES_V2 = Object.keys(V2_STORES) as (keyof typeof V2_STORES)[];
export type TableNameV2 = (typeof TABLE_NAMES_V2)[number];

export interface UpgradeOptions {
  /** Defaults to the device clock. */
  now?: () => Date;
  /** Defaults to crypto.randomUUID(). */
  newId?: () => ID;
}

async function upgradeFromV1(tx: Transaction, options: UpgradeOptions): Promise<void> {
  const read = <R>(name: string) => tx.table(name).toArray() as Promise<R[]>;
  const v1: V1Tables = {
    profiles: await read<L.Profile>('profiles'),
    prescribers: await read<L.Prescriber>('prescribers'),
    medicines: await read<L.Medicine>('medicines'),
    events: await read<L.MedicationEvent>('events'),
    documents: await read<L.DocumentRecord>('documents'),
    prescriptionLines: await read<L.PrescriptionLine>('prescriptionLines'),
    reviewItems: await read<L.ReviewItem>('reviewItems'),
    visits: await read<L.Visit>('visits'),
    shares: await read<StoredShareV1>('shares'),
    settings: await read<SettingRow>('settings'),
  };
  if (Object.values(v1).every((rows) => rows.length === 0)) return;

  const v2 = migrateV1(v1, {
    now: (options.now ?? (() => new Date()))().toISOString(),
    newId: options.newId ?? (() => crypto.randomUUID()),
  });
  // Replace the rows of every table that changed shape; add the new tables' rows.
  for (const [name, rows] of [
    ['profiles', v2.profiles],
    ['documents', v2.documents],
    ['prescriptionLines', v2.prescriptionLines],
    ['visits', v2.visits],
    ['shares', v2.shares],
    ['settings', v2.settings],
  ] as const) {
    await tx.table(name).clear();
    await tx.table(name).bulkPut(rows as unknown[]);
  }
  await tx.table('routine').bulkPut(v2.routine);
  await tx.table('routineEvents').bulkPut(v2.routineEvents);
}

export class CareVaultDbV2 extends Dexie {
  profiles!: Table<Profile, ID>;
  prescribers!: Table<Prescriber, ID>;
  documents!: Table<DocumentRecord, ID>;
  files!: Table<StoredFile, ID>;
  prescriptionLines!: Table<PrescriptionLine, ID>;
  fieldEvidence!: Table<FieldEvidence, ID>;
  routine!: Table<RoutineMedicine, ID>;
  routineEvents!: Table<RoutineEvent, ID>;
  healthEntries!: Table<HealthEntry, ID>;
  proposals!: Table<RoutineProposal, ID>;
  snapshots!: Table<PassportSnapshot, ID>;
  visits!: Table<Visit, ID>;
  shares!: Table<StoredShareV2, ID>;
  gmailImports!: Table<GmailImport, [ID, string, string]>;
  settings!: Table<SettingRow, string>;

  constructor(name: string = DB_NAME, options: UpgradeOptions = {}) {
    super(name);
    this.version(1).stores(V1_STORES);
    this.version(2)
      .stores({ ...V1_STORES, ...V2_STORES })
      .upgrade((tx) => upgradeFromV1(tx, options));
    this.version(3).stores({ ...V2_STORES, medicines: null, events: null, reviewItems: null });
  }
}
