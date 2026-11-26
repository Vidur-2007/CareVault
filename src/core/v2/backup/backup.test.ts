// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone; jsdom's does not.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS, sampleCase } from '../../../contract/fixtures/sampleCase';
import { IDS as V1_IDS, sampleMedicines as v1Medicines } from '../../../contract/legacy/fixtures/sampleCase';
import type { ServiceError } from '../../../contract/types';
import { exportBackup as exportBackupV1 } from '../../backup/backup';
import { createChangeNotifier } from '../../db/events';
import { createRepos } from '../../db/repos';
import { CareVaultDb } from '../../db/schema';
import { loadSampleProfile as loadV1Sample } from '../../db/seed';
import { createReposV2, type ReposV2 } from '../db/repos';
import { CareVaultDbV2 } from '../db/schema';
import { loadSampleProfiles } from '../db/seed';
import { BACKUP_MIME_TYPE, exportBackupV2, findBrokenReference, importBackupV2, payloadToV2, PBKDF2_ITERATIONS } from './backup';

const FAST = { iterations: 1000 };
let counter = 0;
const open: { close(): void; delete(): Promise<void> }[] = [];

function freshV2(): ReposV2 {
  const db = new CareVaultDbV2(`backup-v2-test-${(counter += 1)}`);
  open.push(db);
  return createReposV2(db, createChangeNotifier());
}

afterEach(async () => {
  for (const db of open.splice(0)) {
    db.close();
    await db.delete();
  }
});

/** Every table and file, for comparing two databases. */
async function dump(repos: ReposV2) {
  const tables: Record<string, unknown[]> = {};
  for (const table of repos.db.tables) {
    if (table.name === 'files') continue;
    tables[table.name] = (await table.toArray()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const files = await Promise.all(
    (await repos.files.all()).map(async (f) => [f.id, f.blob.type, await f.blob.text()]),
  );
  return { tables, files: files.sort() };
}

async function populated(): Promise<ReposV2> {
  const repos = freshV2();
  await loadSampleProfiles(repos);
  await repos.files.put(IDS.documents.ecg, new Blob(['%PDF-1.4 ecg'], { type: 'application/pdf' }));
  await repos.fieldEvidence.put({
    id: 'f1', profileId: IDS.ramesh, documentId: IDS.documents.lipidProfile, field: 'document_date', lineIndex: null,
    ingredientIndex: null, page: 1, raw: '12/11/2026', value: '2026-11-12', status: 'user_confirmed', reasons: [],
    source: 'ocr', confidence: 0.93, region: null, reviewedAt: '2026-11-13T09:00:00+05:30',
  });
  await repos.snapshots.put({ id: 's1', profileId: IDS.ramesh, createdAt: '2026-11-14T09:00:00+05:30', reason: 'print', passport: { profileId: IDS.ramesh } as never, revision: 1 });
  await repos.shares.bulkPut([
    { id: 'share-1', profileId: IDS.ramesh, snapshotId: 's1', url: 'https://x/share/share-1#k', createdAt: '2026-11-14T09:00:00+05:30', expiresAt: '2026-11-14T11:00:00+05:30', revoked: false, revokeToken: 'token-1' },
    { id: 'share-v1', profileId: null, snapshotId: null, url: 'https://x/share/share-v1#k', createdAt: null, expiresAt: '2026-11-15T00:00:00Z', revoked: false, revokeToken: 'token-v1' },
  ]);
  await repos.gmailImports.put({ profileId: IDS.ramesh, messageId: 'm', attachmentId: 'a', documentId: IDS.documents.hba1c, importedAt: '2026-11-12T20:06:00+05:30' });
  await repos.routineRevision.bump(IDS.ramesh);
  await repos.settings.set('cloudReadingAllowed', true);
  return repos;
}

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);

describe('backup v2', () => {
  it('round trip: a clean device ends up with exactly the same tables and files', async () => {
    const source = await populated();
    const backup = await exportBackupV2(source, 'correct horse 42', FAST);
    expect(backup.type).toBe(BACKUP_MIME_TYPE);
    const header = JSON.parse((await backup.text()).split('\n')[0]);
    expect(header).toMatchObject({ format: 'carevault-backup', version: 2, kdf: 'PBKDF2-HMAC-SHA256', iterations: 1000 });
    expect(await backup.text()).not.toContain('Ramesh');

    const target = freshV2();
    await target.profiles.put({ ...sampleCase.profiles[1], id: 'someone-else', name: 'To be replaced' });
    await importBackupV2(target, backup, 'correct horse 42');
    expect(await dump(target)).toEqual(await dump(source));
    expect(await target.routineRevision.get(IDS.ramesh)).toBe(1);
    expect((await target.shares.get('share-1'))!.revokeToken).toBe('token-1');
  });

  it('reads the default iteration count from OWASP guidance', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('rejects an empty passphrase on export', async () => {
    expect(await codeOf(exportBackupV2(freshV2(), ''))).toBe('unknown');
  });
});

describe('restoring a v1 backup', () => {
  it('a backup made by the v1 app restores into a clean v2 database, migrated, with nothing lost', async () => {
    const v1db = new CareVaultDb(`backup-v1-source-${(counter += 1)}`);
    open.push(v1db);
    const v1 = createRepos(v1db, createChangeNotifier());
    await loadV1Sample(v1);
    await v1.files.put(V1_IDS.documents.ecg, new Blob(['%PDF-1.4 v1 ecg'], { type: 'application/pdf' }));
    await v1.shares.put({ id: 'v1-share', url: 'https://x/share/v1-share#k', expiresAt: '2026-11-20T00:00:00.000Z', revoked: false, revokeToken: 'v1-token' });
    const backup = await exportBackupV1(v1, 'old passphrase', FAST);
    expect(JSON.parse((await backup.text()).split('\n')[0]).version).toBe(1);

    const target = freshV2();
    let n = 0;
    await importBackupV2(target, backup, 'old passphrase', { now: () => new Date('2026-11-20T10:00:00Z'), newId: () => `migrated-${(n += 1)}` });

    expect((await target.routine.all()).map((m) => m.id).sort()).toEqual(v1Medicines.map((m) => m.id).sort());
    expect(await target.routine.get(V1_IDS.medicines.atorvastatin10)).toMatchObject({ status: 'uncertain', source: 'legacy', legacyReviewPending: true });
    expect(await target.routine.get(V1_IDS.medicines.pantoprazole40)).toMatchObject({ status: 'stopped', source: 'caregiver_reported' });
    expect((await target.routineEvents.all()).filter((e) => e.type === 'migrated')).toHaveLength(v1Medicines.length);
    expect((await target.documents.all()).length).toBe((await v1.documents.all()).length);
    expect(await (await target.files.get(V1_IDS.documents.ecg))!.text()).toBe('%PDF-1.4 v1 ecg');
    expect(await target.shares.get('v1-share')).toMatchObject({ profileId: null, revokeToken: 'v1-token' });
    expect((await target.visits.get(V1_IDS.visit))!.questions).toHaveLength(2);
    // The v2-only tables are empty, not missing.
    expect(await target.healthEntries.all()).toEqual([]);
  });

  it('a v1 payload missing a table is rejected', () => {
    expect(() => payloadToV2(1, { exportedAt: 'x', tables: { profiles: [] }, files: [] })).toThrow('could not be read');
    expect(() => payloadToV2(2, { exportedAt: 'x', tables: {}, files: [] })).toThrow('could not be read');
  });
});

describe('refusals leave the device untouched', () => {
  async function deviceWithData() {
    const repos = await populated();
    return { repos, before: await dump(repos) };
  }

  it('wrong passphrase → bad_passphrase', async () => {
    const backup = await exportBackupV2(await populated(), 'right one', FAST);
    const { repos, before } = await deviceWithData();
    await repos.profiles.put({ ...sampleCase.profiles[0], id: 'extra', name: 'Extra' });
    const withExtra = await dump(repos);
    expect(await codeOf(importBackupV2(repos, backup, 'wrong one'))).toBe('bad_passphrase');
    expect(await codeOf(importBackupV2(repos, backup, ''))).toBe('bad_passphrase');
    expect(await dump(repos)).toEqual(withExtra);
    expect(withExtra).not.toEqual(before);
  });

  it('a damaged file → bad_passphrase (AES-GCM cannot tell the two apart)', async () => {
    const backup = await exportBackupV2(await populated(), 'pw', FAST);
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 5] ^= 1;
    const { repos, before } = await deviceWithData();
    expect(await codeOf(importBackupV2(repos, new Blob([bytes]), 'pw'))).toBe('bad_passphrase');
    expect(await dump(repos)).toEqual(before);
  });

  it('not a backup, or an unknown version → unsupported_file', async () => {
    const { repos, before } = await deviceWithData();
    expect(await codeOf(importBackupV2(repos, new Blob(['%PDF-1.4 not a backup']), 'pw'))).toBe('unsupported_file');
    expect(await codeOf(importBackupV2(repos, new Blob([]), 'pw'))).toBe('unsupported_file');
    const future = JSON.stringify({ format: 'carevault-backup', version: 3, kdf: 'PBKDF2-HMAC-SHA256', iterations: 1000, salt: 'a'.repeat(22), iv: 'b'.repeat(16) });
    expect(await codeOf(importBackupV2(repos, new Blob([future, '\n', 'xyz']), 'pw'))).toBe('unsupported_file');
    expect(await dump(repos)).toEqual(before);
  });

  it('a backup whose references do not resolve → unsupported_file', async () => {
    const source = await populated();
    // A prescription line pointing at a document that is not there, written past the repos.
    await source.db.prescriptionLines.put({ ...sampleCase.prescriptionLines[0], id: 'orphan', documentId: 'gone' });
    const backup = await exportBackupV2(source, 'pw', FAST);
    const { repos, before } = await deviceWithData();
    const error = await importBackupV2(repos, backup, 'pw').catch((e: ServiceError) => e);
    expect(error).toMatchObject({ code: 'unsupported_file', message: 'This backup could not be read: a prescription line has no document.' });
    expect(await dump(repos)).toEqual(before);
  });
});

describe('findBrokenReference', () => {
  const empty = () => ({
    profiles: [{ id: 'p' }], prescribers: [], documents: [{ id: 'd', profileId: 'p' }], prescriptionLines: [], fieldEvidence: [],
    routine: [{ id: 'm', profileId: 'p' }], routineEvents: [], healthEntries: [], proposals: [], snapshots: [], visits: [],
    shares: [], gmailImports: [], settings: [],
  });
  it('accepts a consistent set, and names each kind of break', () => {
    expect(findBrokenReference(empty(), ['d'])).toBeNull();
    expect(findBrokenReference({ ...empty(), healthEntries: [{ id: 'h', profileId: 'x' }] }, [])).toContain('healthEntries');
    expect(findBrokenReference({ ...empty(), shares: [{ id: 's', profileId: 'x' }] }, [])).toContain('share link');
    expect(findBrokenReference({ ...empty(), shares: [{ id: 's', profileId: null }] }, [])).toBeNull();
    expect(findBrokenReference({ ...empty(), fieldEvidence: [{ id: 'f', profileId: 'p', documentId: 'x' }] }, [])).toContain('checked value');
    expect(findBrokenReference({ ...empty(), routineEvents: [{ id: 'e', profileId: 'p', medicineId: 'x' }] }, [])).toContain('history entry');
    expect(findBrokenReference(empty(), ['x'])).toContain('stored file');
  });
});
