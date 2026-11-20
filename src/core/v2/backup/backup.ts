// Encrypted backup, v2: every v2 table and every stored file in one passphrase-protected blob.
//
// Layout (unchanged from v1): one line of JSON (the header), a newline, then the AES-GCM
// ciphertext. The key comes from the passphrase with PBKDF2-HMAC-SHA256.
//
// Import reads version 1 and version 2 backups. A version 1 payload is brought to v2 with the
// same migrateV1 the database upgrade uses. Nothing on the device changes unless the whole
// backup decrypts, has the expected shape and every reference in it resolves; the
// replacement is then one transaction.
import { z } from 'zod';
import { ServiceError, type ID } from '../../../contract/types';
import { fromBase64Url, toBase64Url } from '../../share/crypto';
import { migrateV1, type V1Tables } from '../db/migrate';
import type { ReposV2 } from '../db/repos';
import { TABLE_NAMES_V2, type StoredFile, type TableNameV2 } from '../db/schema';

export const BACKUP_FORMAT = 'carevault-backup';
export const BACKUP_VERSION = 2;
// OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256, 600,000 iterations.
export const PBKDF2_ITERATIONS = 600_000;
export const BACKUP_MIME_TYPE = 'application/vnd.carevault.backup';

const headerSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
  kdf: z.literal('PBKDF2-HMAC-SHA256'),
  iterations: z.number().int().min(1).max(10_000_000),
  salt: z.string().min(16),
  iv: z.string().min(16),
});
type Header = z.infer<typeof headerSchema>;

const row = z.record(z.string(), z.unknown());
const fileSchema = z.object({ id: z.string().min(1), type: z.string(), data: z.string() });

/** The v1 payload, exactly as the v1 exporter wrote it. */
const payloadV1Schema = z.object({
  exportedAt: z.string(),
  tables: z.object({
    profiles: z.array(row),
    prescribers: z.array(row),
    medicines: z.array(row),
    events: z.array(row),
    documents: z.array(row),
    prescriptionLines: z.array(row),
    reviewItems: z.array(row),
    visits: z.array(row),
    shares: z.array(row),
    settings: z.array(z.object({ key: z.string(), value: z.unknown() })),
  }),
  files: z.array(fileSchema),
});

type DataTable = Exclude<TableNameV2, 'files'>;
const DATA_TABLES = TABLE_NAMES_V2.filter((name): name is DataTable => name !== 'files');

const payloadV2Schema = z.object({
  exportedAt: z.string(),
  tables: z.object(Object.fromEntries(DATA_TABLES.map((name) => [name, z.array(row)])) as Record<DataTable, z.ZodArray<typeof row>>),
  files: z.array(fileSchema),
});

type Rows = Record<string, unknown>[];
type DataTables = Record<DataTable, Rows>;

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface BackupOptions {
  /** Lower only in tests: key derivation at full strength takes about a second. */
  iterations?: number;
  now?: () => Date;
  /** Ids for the 'migrated' events made when a v1 backup is restored. */
  newId?: () => ID;
}

export async function exportBackupV2(repos: ReposV2, passphrase: string, options: BackupOptions = {}): Promise<Blob> {
  if (!passphrase) throw new ServiceError('unknown', 'Please enter a passphrase for the backup.');

  // One read transaction over every table, so the copy is consistent. Blobs are turned into
  // bytes afterwards: awaiting a Blob inside the transaction would end it early.
  const { tables, storedFiles } = await repos.db.transaction('r', repos.db.tables, async () => {
    const read: Partial<DataTables> = {};
    for (const name of DATA_TABLES) read[name] = (await repos.db.table(name).toArray()) as Rows;
    return { tables: read as DataTables, storedFiles: (await repos.db.files.toArray()) as StoredFile[] };
  });
  const files = await Promise.all(
    storedFiles.map(async (file) => ({ id: file.id, type: file.blob.type, data: toBase64Url(await file.blob.arrayBuffer()) })),
  );
  const payload = { exportedAt: (options.now ?? (() => new Date()))().toISOString(), tables, files };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));

  const header: Header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: 'PBKDF2-HMAC-SHA256',
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
  };
  return new Blob([JSON.stringify(header), '\n', ciphertext], { type: BACKUP_MIME_TYPE });
}

const notABackup = () => new ServiceError('unsupported_file', 'This file is not a CareVault backup.');
const unreadable = (why: string) => new ServiceError('unsupported_file', `This backup could not be read: ${why}`);

/** Brings a decrypted payload of either version to v2 tables. */
export function payloadToV2(version: 1 | 2, payload: unknown, options: BackupOptions = {}): { tables: DataTables; files: z.infer<typeof fileSchema>[] } {
  if (version === 2) {
    const parsed = payloadV2Schema.safeParse(payload);
    if (!parsed.success) throw unreadable('its contents are not complete.');
    return { tables: parsed.data.tables as DataTables, files: parsed.data.files };
  }
  const parsed = payloadV1Schema.safeParse(payload);
  if (!parsed.success) throw unreadable('its contents are not complete.');
  const migrated = migrateV1(parsed.data.tables as unknown as V1Tables, {
    now: (options.now ?? (() => new Date()))().toISOString(),
    newId: options.newId ?? (() => crypto.randomUUID()),
  });
  const empty = Object.fromEntries(DATA_TABLES.map((name) => [name, []])) as unknown as DataTables;
  return {
    tables: { ...empty, ...(migrated as unknown as Partial<DataTables>) },
    files: parsed.data.files,
  };
}

const PROFILE_SCOPED: DataTable[] = [
  'prescribers', 'documents', 'fieldEvidence', 'routine', 'routineEvents', 'healthEntries', 'proposals', 'snapshots', 'visits', 'gmailImports',
];

/** Every reference must resolve, or nothing is restored. Returns the first problem found, or null. */
export function findBrokenReference(tables: DataTables, fileIds: readonly string[]): string | null {
  const ids = (name: DataTable) => new Set(tables[name].map((r) => r.id as string));
  const profiles = ids('profiles');
  const documents = ids('documents');
  const routine = ids('routine');

  for (const name of PROFILE_SCOPED) {
    if (tables[name].some((r) => !profiles.has(r.profileId as string))) return `a ${name} row belongs to a profile that is not in the backup.`;
  }
  if (tables.shares.some((r) => r.profileId !== null && !profiles.has(r.profileId as string))) {
    return 'a share link belongs to a profile that is not in the backup.';
  }
  if (tables.prescriptionLines.some((r) => !documents.has(r.documentId as string))) return 'a prescription line has no document.';
  if (tables.fieldEvidence.some((r) => !documents.has(r.documentId as string))) return 'a checked value has no document.';
  if (tables.routineEvents.some((r) => !routine.has(r.medicineId as string))) return 'a history entry has no medicine.';
  if (fileIds.some((id) => !documents.has(id))) return 'a stored file has no record.';
  return null;
}

/**
 * Replaces everything on this device with the contents of a backup, version 1 or 2.
 * Nothing changes unless the whole backup is valid; the replacement is one transaction.
 */
export async function importBackupV2(repos: ReposV2, file: Blob, passphrase: string, options: BackupOptions = {}): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const newline = bytes.indexOf(0x0a);
  let header: Header;
  try {
    if (newline < 0 || newline > 2048) throw new Error('no header');
    header = headerSchema.parse(JSON.parse(new TextDecoder().decode(bytes.subarray(0, newline))));
  } catch {
    throw notABackup();
  }

  let text: string;
  try {
    const key = await deriveKey(passphrase, fromBase64Url(header.salt), header.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(header.iv) }, key, bytes.subarray(newline + 1));
    text = new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM fails the same way for a wrong passphrase and for a damaged file.
    throw new ServiceError('bad_passphrase', 'The passphrase is wrong, or the backup file is damaged.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw unreadable('its contents are not valid.');
  }
  const { tables, files } = payloadToV2(header.version, payload, options);

  const broken = findBrokenReference(tables, files.map((f) => f.id));
  if (broken) throw unreadable(broken);

  let blobs: StoredFile[];
  try {
    blobs = files.map((f) => ({ id: f.id, blob: new Blob([fromBase64Url(f.data)], { type: f.type }) }));
  } catch {
    throw unreadable('a stored file is damaged.');
  }

  await repos.transaction(async () => {
    await repos.clearAll();
    for (const name of DATA_TABLES) await repos.db.table(name).bulkPut(tables[name]);
    await repos.files.bulkPut(blobs);
  });
}
