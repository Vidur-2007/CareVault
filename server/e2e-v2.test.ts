// @vitest-environment node
// End to end, v2: the real v2 services on one "phone", the real server routes, and a second
// "browser" that only has the link. The share store is in memory, as in e2e.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDS } from '../src/contract/fixtures/sampleCase.ts';
import type { Passport as PassportV1 } from '../src/contract/legacy/types.ts';
import type { CareVaultServices } from '../src/contract/services.ts';
import type { PassportSnapshot, ServiceError } from '../src/contract/types.ts';
import { uploadPassport } from '../src/core/share/client.ts';
import { decryptJson } from '../src/core/share/crypto.ts';
import { createRealServicesV2 } from '../src/core/v2/createRealServicesV2.ts';
import { CareVaultDbV2 } from '../src/core/v2/db/schema.ts';
import { MESSAGES } from '../src/core/v2/share/client.ts';
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
let fetchVia: typeof fetch;
let phoneDb: CareVaultDbV2;
let otherDb: CareVaultDbV2;
let phone: CareVaultServices;
let doctor: CareVaultServices;

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);
const linkParts = (url: string) => {
  const parsed = new URL(url);
  return { id: parsed.pathname.split('/').pop()!, key: parsed.hash.slice(1) };
};

function servicesOn(db: CareVaultDbV2, shareStore: ShareStore | null = store) {
  const app = createApp({ extractor: null, shareStore, now: () => clock, rateLimit: 1000, staticRoot: null });
  fetchVia = async (input, init) => app.request(String(input), init);
  return createRealServicesV2({ db, now: () => clock, fetch: fetchVia, origin: () => 'https://carevault.example', backupIterations: 1000 });
}

beforeEach(async () => {
  counter += 1;
  clock = new Date('2026-11-14T10:00:00.000Z');
  store = memoryStore();
  phoneDb = new CareVaultDbV2(`e2e-v2-phone-${counter}`);
  otherDb = new CareVaultDbV2(`e2e-v2-other-${counter}`);
  phone = servicesOn(phoneDb);
  doctor = servicesOn(otherDb);
  await phone.profiles.loadSampleProfile();
});

afterEach(async () => {
  phoneDb.close();
  otherDb.close();
  await phoneDb.delete();
  await otherDb.delete();
});

describe('sharing a snapshot, end to end', () => {
  it('the doctor opens exactly the snapshot that was shared; the server only ever saw ciphertext', async () => {
    const snapshot = await phone.passport.snapshot(IDS.ramesh, 'share');
    const link = await phone.sharing.create(snapshot.id, 24);
    expect(link).toMatchObject({ profileId: IDS.ramesh, snapshotId: snapshot.id, revoked: false, createdAt: clock.toISOString(), expiresAt: '2026-11-15T10:00:00.000Z' });
    expect(link.url).toMatch(/^https:\/\/carevault\.example\/share\/[0-9a-f-]+#[A-Za-z0-9_-]{43}$/);
    expect(link).not.toHaveProperty('revokeToken');

    const { id, key } = linkParts(link.url);
    expect(await doctor.sharing.open(id, key)).toEqual(snapshot);
    // What the server stores is the versioned payload, encrypted.
    const row = store.rows[0];
    expect(row.ciphertext).not.toContain('Ramesh');
    expect(await decryptJson({ ciphertext: row.ciphertext, iv: row.iv }, key)).toEqual({ v: 2, snapshot });
  });

  it('a later routine change never alters what the link shows', async () => {
    const snapshot = await phone.passport.snapshot(IDS.ramesh, 'share');
    const link = await phone.sharing.create(snapshot.id, 1);
    await phone.routine.setStatus(IDS.medicines.amlodipine10, 'stopped');
    const { id, key } = linkParts(link.url);
    const opened = await doctor.sharing.open(id, key);
    expect(opened.passport.currentMedicines.map((m) => m.productName)).toContain('Amlodipine 10 mg');
  });

  it('expiry, revoke and a wrong key', async () => {
    const snapshot = await phone.passport.snapshot(IDS.ramesh, 'share');
    const link = await phone.sharing.create(snapshot.id, 2);
    const { id, key } = linkParts(link.url);

    expect(await codeOf(doctor.sharing.open(id, 'A'.repeat(43)))).toBe('unknown');
    expect((await doctor.sharing.open(id, 'A'.repeat(43)).catch((e: Error) => e)).message).toBe(MESSAGES.wrongKey);
    expect(await codeOf(doctor.sharing.open('00000000-0000-4000-8000-999999999999', key))).toBe('not_found');

    clock = new Date('2026-11-14T12:00:01.000Z');
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('expired');

    clock = new Date('2026-11-14T10:30:00.000Z');
    await phone.sharing.revoke(link.id);
    expect(await codeOf(doctor.sharing.open(id, key))).toBe('revoked');
    expect((await phone.sharing.list(IDS.ramesh))[0].revoked).toBe(true);
    // Revoking twice is fine.
    await phone.sharing.revoke(link.id);
    expect(await codeOf(phone.sharing.revoke('nope'))).toBe('not_found');
  });

  it('lifetimes from 1 hour to 7 days only', async () => {
    const snapshot = await phone.passport.snapshot(IDS.ramesh, 'share');
    for (const hours of [0, 0.5, 24 * 7 + 1, Number.NaN]) expect(await codeOf(phone.sharing.create(snapshot.id, hours)), String(hours)).toBe('unknown');
    expect((await phone.sharing.create(snapshot.id, 24 * 7)).expiresAt).toBe('2026-11-21T10:00:00.000Z');
    expect(await codeOf(phone.sharing.create('nope', 1))).toBe('not_found');
    expect(store.rows).toHaveLength(1);
  });

  it("two profiles with links: neither sees the other's, and v1 links are listed only as unowned", async () => {
    const ramesh = await phone.sharing.create((await phone.passport.snapshot(IDS.ramesh, 'share')).id, 1);
    clock = new Date('2026-11-14T10:05:00.000Z');
    const lakshmi = await phone.sharing.create((await phone.passport.snapshot(IDS.lakshmi, 'share')).id, 1);
    const ramesh2 = await phone.sharing.create((await phone.passport.snapshot(IDS.ramesh, 'share')).id, 3);
    await phoneDb.shares.put({ id: 'v1-link', profileId: null, snapshotId: null, url: 'https://carevault.example/share/v1-link#k', createdAt: null, expiresAt: '2026-11-16T10:00:00.000Z', revoked: false, revokeToken: 'secret' });

    expect((await phone.sharing.list(IDS.ramesh)).map((l) => l.id)).toEqual([ramesh2.id, ramesh.id]);
    expect((await phone.sharing.list(IDS.lakshmi)).map((l) => l.id)).toEqual([lakshmi.id]);
    const unowned = await phone.sharing.listUnowned();
    expect(unowned).toEqual([{ id: 'v1-link', profileId: null, snapshotId: null, url: 'https://carevault.example/share/v1-link#k', createdAt: null, expiresAt: '2026-11-16T10:00:00.000Z', revoked: false }]);
    expect(await codeOf(phone.sharing.list('nope'))).toBe('not_found');
  });

  it('a link made by v1 still opens, wrapped as a snapshot', async () => {
    const v1: PassportV1 = {
      patientName: 'Ramesh Iyer', patientAge: 71, preparedBy: 'Anjali Iyer, daughter', preparedOn: '2026-11-10',
      visitAt: '2026-11-18T10:30:00+05:30', prescriberName: 'Dr. Kavita Rao', prescriberSpecialty: 'Cardiology',
      currentMedicines: [{ productName: 'Amlodipine 10 mg', instruction: '1 tablet, morning', prescriberName: 'Dr. Kavita Rao' }],
      changesSince: '2026-10-28',
      changes: [{ kind: 'added', text: 'Rosuvastatin 10 mg' }, { kind: 'changed', text: 'Amlodipine 5 mg to 10 mg' }, { kind: 'unconfirmed', text: 'Atorvastatin 10 mg' }],
      flags: ['Dolo 650 and Crocin Advance 500 both contain paracetamol.'],
      documents: [{ title: 'Lipid profile', documentDate: '2026-11-12' }],
      questions: ['Does Rosuvastatin replace Atorvastatin?'],
    };
    const made = await uploadPassport(v1, '2026-11-15T10:00:00.000Z', fetchVia);
    const opened: PassportSnapshot = await doctor.sharing.open(made.id, made.key);
    expect(opened).toMatchObject({ id: made.id, profileId: '', reason: 'share', revision: 0 });
    expect(opened.passport).toMatchObject({
      patientName: 'Ramesh Iyer', preparedOn: '2026-11-10',
      visit: { at: '2026-11-18T10:30:00+05:30', prescriberName: 'Dr. Kavita Rao', specialty: 'Cardiology' },
      currentMedicines: [{ productName: 'Amlodipine 10 mg', instruction: '1 tablet, morning', prescriberName: 'Dr. Kavita Rao', ingredientsText: '', source: 'legacy', lastConfirmedOn: null }],
      unconfirmed: [{ productName: 'Atorvastatin 10 mg', reason: 'Not confirmed' }],
      recentChanges: [{ kind: 'started', text: 'Rosuvastatin 10 mg', on: '2026-10-28' }, { kind: 'changed', text: 'Amlodipine 5 mg to 10 mg', on: '2026-10-28' }],
      allergies: { state: 'not_recorded', items: [] },
      documents: [{ title: 'Lipid profile', clinicalDate: '2026-11-12', documentId: '', sha256: '', removedAt: null }],
      questions: ['Does Rosuvastatin replace Atorvastatin?'],
    });
  });

  it('a payload that is neither v2 nor v1 is refused', async () => {
    const made = await uploadPassport({ hello: 'world' } as unknown as PassportV1, '2026-11-15T10:00:00.000Z', fetchVia);
    const error = await doctor.sharing.open(made.id, made.key).catch((e: ServiceError) => e);
    expect(error).toMatchObject({ code: 'unknown', message: MESSAGES.notPassport });
  });

  it('a server without sharing: not_configured, with a message for the caregiver', async () => {
    const off = servicesOn(phoneDb, null);
    const snapshot = await off.passport.snapshot(IDS.ramesh, 'share');
    const error = await off.sharing.create(snapshot.id, 1).catch((e: ServiceError) => e);
    expect(error).toMatchObject({ code: 'not_configured', message: MESSAGES.notConfigured });
    expect(await codeOf(off.sharing.open('00000000-0000-4000-8000-000000000001', 'k'))).toBe('not_configured');
    expect(await phoneDb.shares.count()).toBe(0);
  });

  it('no error message carries a status code', () => {
    for (const message of Object.values(MESSAGES)) expect(message).not.toMatch(/\d{3}/);
  });

  it('offline: a network error, and nothing is stored', async () => {
    const offline = createRealServicesV2({ db: phoneDb, now: () => clock, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
    const snapshot = await offline.passport.snapshot(IDS.ramesh, 'share');
    expect(await codeOf(offline.sharing.create(snapshot.id, 1))).toBe('network');
    expect(await phoneDb.shares.count()).toBe(0);
  });
});
