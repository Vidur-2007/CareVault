// @vitest-environment node
// End to end: the real services on one "phone", the real server routes, and a second
// "browser" that only has the link. The share store is in memory.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDS } from '../src/contract/legacy/fixtures/sampleCase.ts';
import type { CareVaultServices } from '../src/contract/legacy/services.ts';
import type { Passport, ServiceError } from '../src/contract/legacy/types.ts';
import { exportBackup, importBackup, PBKDF2_ITERATIONS } from '../src/core/backup/backup.ts';
import { createRealServices } from '../src/core/createRealServices.ts';
import { CareVaultDb } from '../src/core/db/schema.ts';
import { decryptJson, encryptJson, fromBase64Url, toBase64Url } from '../src/core/share/crypto.ts';
import { createApp } from './index.ts';
import type { ShareRow, ShareStore } from './share.ts';

function memoryStore(): ShareStore & { rows: ShareRow[] } {
  const rows: ShareRow[] = [];
  let n = 0;
  return {
    rows,
    async create(row) {
      const id = `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
      rows.push({ ...row, id, revoked: false });
      return id;
    },
    get: async (id) => rows.find((r) => r.id === id) ?? null,
    async revoke(id) {
      const row = rows.find((r) => r.id === id);
      if (row) row.revoked = true;
    },
    ping: async () => true,
  };
}

let counter = 0;
let clock: Date;
let store: ReturnType<typeof memoryStore>;
let online: boolean;
let phoneDb: CareVaultDb;
let otherDb: CareVaultDb;
let phone: CareVaultServices;
let doctor: CareVaultServices;
let passport: Passport;

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);
const linkParts = (url: string) => {
  const parsed = new URL(url);
  return { id: parsed.pathname.split('/').pop()!, key: parsed.hash.slice(1) };
};

beforeEach(async () => {
  counter += 1;
  clock = new Date('2026-11-14T10:00:00.000Z');
  online = true;
  store = memoryStore();
  const app = createApp({ extractor: null, shareStore: store, now: () => clock, rateLimit: 1000, staticRoot: null });
  const viaServer: typeof fetch = async (input, init) => {
    if (!online) throw new TypeError('Failed to fetch');
    return app.request(String(input), init);
  };
  phoneDb = new CareVaultDb(`e2e-phone-${counter}`);
  otherDb = new CareVaultDb(`e2e-other-${counter}`);
  const options = { now: () => clock, fetch: viaServer, origin: () => 'https://carevault.example', backupIterations: 1000 };
  phone = createRealServices({ ...options, db: phoneDb });
  doctor = createRealServices({ ...options, db: otherDb });
  await phone.profiles.loadSampleProfile();
  passport = await phone.visits.buildPassport(IDS.profile);
});

afterEach(async () => {
  await phoneDb.delete();
  await otherDb.delete();
});

describe('encryption', () => {
  it('encrypt then decrypt gives the data back', async () => {
    const sealed = await encryptJson(passport);
    expect(fromBase64Url(sealed.key)).toHaveLength(32);
    expect(fromBase64Url(sealed.iv)).toHaveLength(12);
    expect(sealed.ciphertext).not.toContain('Ramesh');
    expect(await decryptJson(sealed, sealed.key)).toEqual(passport);
  });

  it('uses a new key and a new IV every time', async () => {
    const a = await encryptJson(passport);
    const b = await encryptJson(passport);
    expect(a.key).not.toBe(b.key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('a wrong key, a short key or an altered ciphertext fails', async () => {
    const sealed = await encryptJson(passport);
    const other = await encryptJson('x');
    await expect(decryptJson(sealed, other.key)).rejects.toThrow();
    await expect(decryptJson(sealed, sealed.key.slice(0, 20))).rejects.toThrow('wrong length');
    await expect(decryptJson(sealed, 'not base64url!')).rejects.toThrow();
    const bytes = fromBase64Url(sealed.ciphertext);
    bytes[5] ^= 1;
    await expect(decryptJson({ ...sealed, ciphertext: toBase64Url(bytes) }, sealed.key)).rejects.toThrow();
  });
});

describe('sharing, phone to second browser', () => {
  it('creates a link whose key is only in the fragment, and the server holds only ciphertext', async () => {
    const link = await phone.sharing.create(passport, 8);
    expect(link).toEqual({
      id: store.rows[0].id,
      url: expect.stringMatching(/^https:\/\/carevault\.example\/share\/[0-9a-f-]{36}#[A-Za-z0-9_-]{43}$/),
      expiresAt: '2026-11-14T18:00:00.000Z',
      revoked: false,
    });
    const { key } = linkParts(link.url);
    const stored = JSON.stringify(store.rows);
    expect(stored).not.toContain(key);
    expect(stored).not.toContain('Ramesh');
    expect(stored).not.toContain('Atorvastatin');
    expect(await phone.sharing.list()).toEqual([link]);
    // The revoke token stays on the phone and is not part of the contract's ShareLink.
    expect(Object.keys((await phone.sharing.list())[0]).sort()).toEqual(['expiresAt', 'id', 'revoked', 'url']);
    expect((await phoneDb.shares.get(link.id))!.revokeToken.length).toBeGreaterThan(20);
  });

  it('opens in a second browser with nothing but the link', async () => {
    const link = await phone.sharing.create(passport, 2);
    const { id, key } = linkParts(link.url);
    expect(await doctor.sharing.open(id, key)).toEqual(passport);
    expect(await doctor.sharing.list()).toEqual([]);
  });

  it('stops working after revoke', async () => {
    const link = await phone.sharing.create(passport, 2);
    const { id, key } = linkParts(link.url);
    await phone.sharing.revoke(id);
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('revoked');
    expect((await phone.sharing.list())[0].revoked).toBe(true);
    await phone.sharing.revoke(id);
    expect(await codeOf(phone.sharing.revoke('unknown-link'))).toBe('not_found');
  });

  it('stops working when it expires', async () => {
    const link = await phone.sharing.create(passport, 2);
    const { id, key } = linkParts(link.url);
    clock = new Date('2026-11-14T11:59:59.000Z');
    expect(await doctor.sharing.open(id, key)).toEqual(passport);
    clock = new Date('2026-11-14T12:00:00.000Z');
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('expired');
  });

  it('keeps the lifetime between one hour and seven days', async () => {
    expect((await phone.sharing.create(passport, 0)).expiresAt).toBe('2026-11-14T11:00:00.000Z');
    expect((await phone.sharing.create(passport, Number.NaN)).expiresAt).toBe('2026-11-14T11:00:00.000Z');
    expect((await phone.sharing.create(passport, 24 * 365)).expiresAt).toBe('2026-11-21T10:00:00.000Z');
    expect((await phone.sharing.list()).map((l) => l.expiresAt)).toEqual([
      '2026-11-21T10:00:00.000Z', '2026-11-14T11:00:00.000Z', '2026-11-14T11:00:00.000Z',
    ]);
  });

  it('rejects a wrong key, an unknown link and a link that holds something else', async () => {
    const link = await phone.sharing.create(passport, 2);
    const { id } = linkParts(link.url);
    const other = linkParts((await phone.sharing.create(passport, 2)).url);
    expect(await codeOf(doctor.sharing.open(id, other.key))).toBe('unknown');
    expect(await codeOf(doctor.sharing.open(id, ''))).toBe('unknown');
    expect(await codeOf(doctor.sharing.open('00000000-0000-4000-8000-999999999999', other.key))).toBe('not_found');
    expect(await codeOf(doctor.sharing.open('not-an-id', other.key))).toBe('not_found');

    const notPassport = await encryptJson({ hello: 'world' });
    const row = await store.create({ ciphertext: notPassport.ciphertext, iv: notPassport.iv, expires_at: '2026-11-15T00:00:00.000Z', revoke_token_hash: 'ab' });
    expect(await codeOf(doctor.sharing.open(row, notPassport.key))).toBe('unknown');
  });

  it('reports network failures, and keeps the link usable when a revoke could not be sent', async () => {
    const link = await phone.sharing.create(passport, 2);
    const { id, key } = linkParts(link.url);
    online = false;
    expect(await codeOf(phone.sharing.create(passport, 2))).toBe('network');
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('network');
    expect(await codeOf(phone.sharing.revoke(id))).toBe('network');
    expect((await phone.sharing.list())[0].revoked).toBe(false);
    online = true;
    await phone.sharing.revoke(id);
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('revoked');
  });

  it('treats a link the server no longer has as revoked', async () => {
    const link = await phone.sharing.create(passport, 2);
    store.rows.length = 0;
    await phone.sharing.revoke(link.id);
    expect((await phone.sharing.list())[0].revoked).toBe(true);
  });
});

describe('backup', () => {
  const file = (text = 'echo') => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });

  it('round trip: export, wipe, import restores every table and file', async () => {
    const { record } = await phone.documents.add(IDS.profile, file(), {
      type: 'test', title: 'Echo report', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    await phone.settings.setCloudReadingAllowed(true);
    await phone.review.resolve(IDS.reviewItems.confirmAtorvastatin, 'still_taking');
    const link = await phone.sharing.create(passport, 2);
    const before = Object.fromEntries(await Promise.all(phoneDb.tables.filter((t) => t.name !== 'files').map(async (t) => [t.name, await t.toArray()])));

    const backup = await phone.backup.export('correct horse battery staple');
    const head = (await backup.text()).split('\n')[0];
    expect(JSON.parse(head)).toMatchObject({ format: 'carevault-backup', version: 1, kdf: 'PBKDF2-HMAC-SHA256', iterations: 1000 });
    expect(await backup.text()).not.toContain('Ramesh');

    // A different device: empty, then restored from the backup.
    await doctor.profiles.create({ name: 'Someone else', relation: '', birthYear: null, caregiverName: '', caregiverRelation: '' });
    await doctor.backup.import(backup, 'correct horse battery staple');
    const after = Object.fromEntries(await Promise.all(otherDb.tables.filter((t) => t.name !== 'files').map(async (t) => [t.name, await t.toArray()])));
    expect(after).toEqual(before);
    expect((await doctor.profiles.list()).map((p) => p.name)).toEqual(['Ramesh Iyer']);
    expect(await doctor.settings.get()).toEqual({ cloudReadingAllowed: true });
    expect((await doctor.medicines.get(IDS.medicines.atorvastatin10)).status).toBe('confirmed_current');
    const restored = await doctor.documents.file(record.id);
    expect(restored.type).toBe('application/pdf');
    expect(await restored.text()).toBe('%PDF-1.4 echo');
    // The restored device can still revoke the link made before the backup.
    await doctor.sharing.revoke(link.id);
    expect(store.rows[0].revoked).toBe(true);
  });

  it('a wrong passphrase rejects with bad_passphrase and leaves the device untouched', async () => {
    const backup = await phone.backup.export('right');
    await doctor.profiles.create({ name: 'Keep me', relation: '', birthYear: null, caregiverName: '', caregiverRelation: '' });
    expect(await codeOf(doctor.backup.import(backup, 'wrong'))).toBe('bad_passphrase');
    expect(await codeOf(doctor.backup.import(backup, ''))).toBe('bad_passphrase');
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 3] ^= 1;
    expect(await codeOf(doctor.backup.import(new Blob([bytes]), 'right'))).toBe('bad_passphrase');
    expect((await doctor.profiles.list()).map((p) => p.name)).toEqual(['Keep me']);
  });

  it('rejects files that are not a backup', async () => {
    expect(await codeOf(doctor.backup.import(file(), 'x'))).toBe('unsupported_file');
    expect(await codeOf(doctor.backup.import(new Blob(['{"format":"other"}\nabc']), 'x'))).toBe('unsupported_file');
    expect(await codeOf(doctor.backup.import(new Blob([]), 'x'))).toBe('unsupported_file');
    expect(await codeOf(phone.backup.export(''))).toBe('unknown');
  });

  it('rejects a backup that decrypts but does not hold CareVault data', async () => {
    const repos = { db: otherDb, files: { all: async () => [] } } as unknown as Parameters<typeof exportBackup>[0];
    const good = await exportBackup(repos, 'pw', { iterations: 1000 });
    expect(JSON.parse((await good.text()).split('\n')[0]).salt.length).toBeGreaterThan(16);
    const odd = { ...repos, db: { table: () => ({ toArray: async () => 'not rows' }) } } as unknown as Parameters<typeof exportBackup>[0];
    const bad = await exportBackup(odd, 'pw', { iterations: 1000 });
    await expect(importBackup(repos, bad, 'pw')).rejects.toMatchObject({ code: 'unsupported_file' });
  });

  it('uses the OWASP iteration count by default and notifies subscribers after an import', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const backup = await phone.backup.export('pw');
    let calls = 0;
    doctor.subscribe(() => (calls += 1));
    await doctor.backup.import(backup, 'pw');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
  });
});
