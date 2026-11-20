// The local database. Everything the caregiver records lives here, in the browser.
import Dexie, { type Table } from 'dexie';
import type {
  DocumentRecord,
  ID,
  Medicine,
  MedicationEvent,
  PrescriptionLine,
  Prescriber,
  Profile,
  ReviewItem,
  ShareLink,
  Visit,
} from '../../contract/legacy/types';

export const DB_NAME = 'carevault';

/** The original image or PDF of a document. `id` equals the document id. */
export interface StoredFile {
  id: ID;
  blob: Blob;
}

/** A share link plus the secret needed to revoke it. The secret never leaves this table. */
export interface StoredShare extends ShareLink {
  revokeToken: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export const TABLE_NAMES = [
  'profiles',
  'prescribers',
  'medicines',
  'events',
  'documents',
  'files',
  'prescriptionLines',
  'reviewItems',
  'visits',
  'shares',
  'settings',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

export class CareVaultDb extends Dexie {
  profiles!: Table<Profile, ID>;
  prescribers!: Table<Prescriber, ID>;
  medicines!: Table<Medicine, ID>;
  events!: Table<MedicationEvent, ID>;
  documents!: Table<DocumentRecord, ID>;
  files!: Table<StoredFile, ID>;
  prescriptionLines!: Table<PrescriptionLine, ID>;
  reviewItems!: Table<ReviewItem, ID>;
  visits!: Table<Visit, ID>;
  shares!: Table<StoredShare, ID>;
  settings!: Table<SettingRow, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      profiles: 'id',
      prescribers: 'id, profileId',
      medicines: 'id, profileId, [profileId+status]',
      events: 'id, profileId, medicineId, at',
      documents: 'id, profileId, sha256, documentDate',
      files: 'id',
      prescriptionLines: 'id, documentId',
      // resolvedAt is null while an item is open, and IndexedDB does not index null,
      // so open items are found by profileId and filtered in memory.
      reviewItems: 'id, profileId, resolvedAt',
      visits: 'id, profileId, at',
      shares: 'id',
      settings: 'key',
    });
  }
}
