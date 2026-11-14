// Encrypted backup: every table and every stored file in one passphrase-protected blob.
//
// Layout: one line of JSON (the header), a newline, then the AES-GCM ciphertext.
// The key is derived from the passphrase with PBKDF2-HMAC-SHA256.
import { z } from 'zod';
import { ServiceError } from '../../contract/types';
import type { Repos } from '../db/repos';
import { TABLE_NAMES, type TableName } from '../db/schema';
import { fromBase64Url, toBase64Url } from '../share/crypto';

export const BACKUP_VERSION = 1;
// OWASP Password Storage Cheat Sheet, read 2026-11-14: PBKDF2-HMAC-SHA256, 600,000 iterations.
export const PBKDF2_ITERATIONS = 600_000;
export const BACKUP_MIME_TYPE = 'application/vnd.carevault.backup';

const headerSchema = z.object({
  format: z.literal('carevault-backup'),
  version: z.literal(BACKUP_VERSION),
  kdf: z.literal('PBKDF2-HMAC-SHA256'),
  iterations: z.number().int().min(1).max(10_000_000),
  salt: z.string().min(16),
  iv: z.string().min(16),
});
type Header = z.infer<typeof headerSchema>;

const row = z.record(z.string(), z.unknown());
const payloadSchema = z.object({
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
  files: z.array(z.object({ id: z.string(), type: z.string(), data: z.string() })),
});

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
}

export async function exportBackup(repos: Repos, passphrase: string, options: BackupOptions = {}): Promise<Blob> {
  if (!passphrase) throw new ServiceError('unknown', 'Please enter a passphrase for the backup.');

  const tables: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    if (name !== 'files') tables[name] = await repos.db.table(name).toArray();
  }
  const files = await Promise.all(
    (await repos.files.all()).map(async (file) => ({
      id: file.id,
      type: file.blob.type,
      data: toBase64Url(await file.blob.arrayBuffer()),
    })),
  );
  const payload = { exportedAt: (options.now ?? (() => new Date()))().toISOString(), tables, files };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));

  const header: Header = {
    format: 'carevault-backup',
    version: BACKUP_VERSION,
    kdf: 'PBKDF2-HMAC-SHA256',
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
  };
  return new Blob([JSON.stringify(header), '\n', ciphertext], { type: BACKUP_MIME_TYPE });
}

/**
 * Replaces everything on this device with the contents of a backup. Nothing is touched
 * unless the whole backup decrypts and checks out; the replacement is one transaction.
 */
export async function importBackup(repos: Repos, file: Blob, passphrase: string): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const newline = bytes.indexOf(0x0a);
  let header: Header;
  try {
    if (newline < 0 || newline > 2048) throw new Error('no header');
    header = headerSchema.parse(JSON.parse(new TextDecoder().decode(bytes.subarray(0, newline))));
  } catch {
    throw new ServiceError('unsupported_file', 'This file is not a CareVault backup.');
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

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(text));
  } catch {
    throw new ServiceError('unsupported_file', 'This backup could not be read.');
  }
  const files = payload.files.map((f) => ({ id: f.id, blob: new Blob([fromBase64Url(f.data)], { type: f.type }) }));

  await repos.transaction(async () => {
    await repos.clearAll();
    for (const name of Object.keys(payload.tables) as Exclude<TableName, 'files'>[]) {
      await repos.db.table(name).bulkPut(payload.tables[name]);
    }
    await repos.files.bulkPut(files);
  });
}
