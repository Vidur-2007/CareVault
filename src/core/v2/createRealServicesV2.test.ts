// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone; jsdom's does not.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, sampleCase } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { ServiceError, type DocumentRecord, type Passport } from '../../contract/types';
import table from '../drugref/table.json';
import { createRealServicesV2, detectMimeType, isIsoDate, newestDocumentFirst } from './createRealServicesV2';
import { CareVaultDbV2 } from './db/schema';

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;
let clock: Date;
let idCounter: number;
let fetcher: ReturnType<typeof vi.fn>;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pdf = (text: string) => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);

beforeEach(async () => {
  counter += 1;
  idCounter = 0;
  clock = new Date('2026-11-14T09:00:00+05:30');
  db = new CareVaultDbV2(`services-v2-test-${counter}`);
  fetcher = vi.fn(async (url: string) => (String(url).includes('ecg') ? new Response('%PDF-sample ecg') : new Response('', { status: 404 })));
  services = createRealServicesV2({ db, now: () => clock, newId: () => `id-${(idCounter += 1)}`, fetch: fetcher as unknown as typeof fetch, backupIterations: 1000 });
  await services.profiles.loadSampleProfile();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('profiles and doctors', () => {
  it('lists, creates and updates profiles', async () => {
    expect((await services.profiles.list()).map((p) => p.id)).toEqual([IDS.ramesh, IDS.lakshmi]);
    const created = await services.profiles.create({
      name: '  Meera Nair ', relation: 'Myself', birthYear: null, caregiverName: '', caregiverRelation: '', emergencyContact: '  ',
    });
    expect(created).toEqual({
      id: 'id-1', name: 'Meera Nair', relation: 'Myself', birthYear: null, caregiverName: '', caregiverRelation: '',
      emergencyContact: null, createdAt: clock.toISOString(),
    });
    const updated = await services.profiles.update(created.id, { emergencyContact: ' Ravi, +91 90000 11111 ', name: 'Meera N.' });
    expect(updated).toMatchObject({ name: 'Meera N.', emergencyContact: 'Ravi, +91 90000 11111', createdAt: created.createdAt, id: created.id });
    expect((await codeOf(services.profiles.update(created.id, { name: ' ' })))).toBe('unknown');
    expect(await codeOf(services.profiles.update('nobody', { name: 'x' }))).toBe('not_found');
    expect(await codeOf(services.profiles.create({ ...created, name: '' }))).toBe('unknown');
  });

  it('loading the sample twice changes nothing', async () => {
    const before = await Promise.all(db.tables.map((t) => t.count()));
    expect((await services.profiles.loadSampleProfile()).id).toBe(IDS.ramesh);
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(before);
  });

  it('addPrescriber reuses a doctor of the same name, per profile', async () => {
    const first = await services.profiles.addPrescriber(IDS.ramesh, { name: ' Dr.  Neha Shah ', specialty: ' Neurology ' });
    expect(first).toEqual({ id: 'id-1', profileId: IDS.ramesh, name: 'Dr. Neha Shah', specialty: 'Neurology' });
    expect(await services.profiles.addPrescriber(IDS.ramesh, { name: 'dr. neha shah', specialty: '' })).toEqual(first);
    expect(await services.profiles.addPrescriber(IDS.ramesh, { name: 'DR. KAVITA RAO', specialty: '' })).toMatchObject({ id: IDS.prescribers.rao });
    // The same name for another profile is another doctor record.
    expect((await services.profiles.addPrescriber(IDS.lakshmi, { name: 'Dr. Neha Shah', specialty: '' })).id).toBe('id-2');
    expect((await services.profiles.prescribers(IDS.ramesh)).map((p) => p.name)).toEqual(['Dr. Kavita Rao', 'Dr. Neha Shah', 'Dr. Suresh Menon']);
    expect(await codeOf(services.profiles.addPrescriber(IDS.ramesh, { name: '  ', specialty: '' }))).toBe('unknown');
    expect(await codeOf(services.profiles.addPrescriber('nobody', { name: 'Dr. X', specialty: '' }))).toBe('not_found');
  });
});

describe('documents.add', () => {
  it('stores the original first, pending review, with nothing guessed', async () => {
    const file = Object.assign(pdf('new prescription'), { name: 'rx_dr-rao.pdf' });
    const { record, duplicate } = await services.documents.add(IDS.ramesh, file, { source: 'upload' });
    expect(duplicate).toBeNull();
    expect(record).toEqual({
      id: 'id-1', profileId: IDS.ramesh, kind: 'other', title: 'rx dr rao', clinicalDate: null, dateSource: 'unknown',
      addedAt: clock.toISOString(), receivedAt: null, source: 'upload', state: 'pending_review', starred: false,
      prescriberId: null, facility: null, tags: [], testNames: [], patientNameRead: null, patientMatch: 'not_found',
      mimeType: 'application/pdf', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), pageCount: null, pagesRead: null,
    });
    const stored = await services.documents.file(record.id);
    expect(await stored.blob.text()).toBe('%PDF-1.4 new prescription');
    expect((await services.documents.add(IDS.ramesh, pdf('x'), { source: 'camera', title: '  Label  ' })).record.title).toBe('Label');
    expect((await services.documents.add(IDS.ramesh, pdf('y'), { source: 'camera' })).record.title).toBe('New record');
  });

  it('reports an exact duplicate from any source, within the profile only', async () => {
    const first = await services.documents.add(IDS.ramesh, pdf('same bytes'), { source: 'camera' });
    clock = new Date('2026-11-14T10:00:00+05:30');
    const second = await services.documents.add(IDS.ramesh, pdf('same bytes'), { source: 'email' });
    expect(second.duplicate).toEqual({ existingId: first.record.id, existingTitle: 'New record', existingAddedAt: first.record.addedAt, exact: true });
    // The new record is stored too: "use the existing one" means removing it.
    expect(await services.documents.get(second.record.id)).toBeDefined();
    const third = await services.documents.add(IDS.ramesh, pdf('same bytes'), { source: 'upload' });
    expect(third.duplicate?.existingId).toBe(first.record.id);
    expect((await services.documents.add(IDS.lakshmi, pdf('same bytes'), { source: 'upload' })).duplicate).toBeNull();
    expect((await services.documents.add(IDS.ramesh, pdf('other bytes'), { source: 'upload' })).duplicate).toBeNull();
  });

  it('sniffs the type when the browser gives none, and rejects what is not a photo or a PDF', async () => {
    const add = (blob: Blob) => services.documents.add(IDS.ramesh, blob, { source: 'upload' });
    expect((await add(new Blob(['%PDF-1.7 untyped']))).record.mimeType).toBe('application/pdf');
    expect((await add(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])]))).record.mimeType).toBe('image/jpeg');
    expect((await add(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])], { type: 'application/octet-stream' }))).record.mimeType).toBe('image/png');
    expect((await add(new Blob(['anything'], { type: 'image/heic' }))).record.mimeType).toBe('image/heic');
    const before = await db.documents.count();
    expect(await codeOf(add(new Blob(['plain'], { type: 'text/plain' })))).toBe('unsupported_file');
    expect(await codeOf(add(new Blob([])))).toBe('unsupported_file');
    expect(await codeOf(add(new Blob([], { type: 'application/pdf' })))).toBe('unsupported_file');
    expect(await codeOf(add(new Blob(['%PDF-1.4'], { type: 'application/zip' })))).toBe('unsupported_file');
    expect(await codeOf(services.documents.add('nobody', pdf('x'), { source: 'upload' }))).toBe('not_found');
    expect(await db.documents.count()).toBe(before);
  });
});

describe('documents: read, update, file', () => {
  it('lists newest clinical date first, undated last', async () => {
    expect((await services.documents.list(IDS.ramesh)).map((d) => d.id)).toEqual([...sampleCase.expected.ramesh.documentIdsNewestFirst]);
    const { record } = await services.documents.add(IDS.ramesh, pdf('undated'), { source: 'upload' });
    const ids = (await services.documents.list(IDS.ramesh)).map((d) => d.id);
    expect(ids.slice(-2)).toEqual([record.id, IDS.documents.hba1c]);
    expect((await services.documents.list(IDS.lakshmi)).map((d) => d.id)).toEqual([IDS.documents.lakshmiThyroid]);
  });

  it('update: a date set by the user is marked as such; invalid input is refused', async () => {
    const id = IDS.documents.hba1c;
    const updated = await services.documents.update(id, {
      clinicalDate: '2026-11-11', title: ' HbA1c ', tags: [' Blood Test', 'blood test ', ''], testNames: [' HbA1c ', 'HbA1c'],
      facility: '  ', starred: true, kind: 'lab_report', prescriberId: IDS.prescribers.menon,
    });
    expect(updated).toMatchObject({
      clinicalDate: '2026-11-11', dateSource: 'user', title: 'HbA1c', tags: ['blood test'], testNames: ['HbA1c'],
      facility: null, starred: true, prescriberId: IDS.prescribers.menon,
    });
    expect(await services.documents.update(id, { clinicalDate: null })).toMatchObject({ clinicalDate: null, dateSource: 'unknown' });
    expect(await codeOf(services.documents.update(id, { clinicalDate: '2026-02-30' }))).toBe('unknown');
    expect(await codeOf(services.documents.update(id, { clinicalDate: '12/11/2026' }))).toBe('unknown');
    expect(await codeOf(services.documents.update(id, { title: '' }))).toBe('unknown');
    // A doctor of another profile cannot be linked.
    expect(await codeOf(services.documents.update(id, { prescriberId: IDS.prescribers.khan }))).toBe('not_found');
    expect(await codeOf(services.documents.update('nope', { starred: true }))).toBe('not_found');
    expect((await services.documents.update(id, { prescriberId: null })).prescriberId).toBeNull();
  });

  it('fileRecord marks a record filed, once', async () => {
    expect((await services.documents.fileRecord(IDS.documents.hba1c)).state).toBe('filed');
    expect((await services.documents.fileRecord(IDS.documents.hba1c)).state).toBe('filed');
  });

  it('file: stored bytes, or the shipped sample document', async () => {
    const ecg = await services.documents.file(IDS.documents.ecg);
    expect(ecg).toMatchObject({ id: IDS.documents.ecg, title: 'ECG report' });
    expect(await ecg.blob.text()).toBe('%PDF-sample ecg');
    expect(fetcher).toHaveBeenCalledWith('/sample-docs/ecg-report-2026-09-15.pdf');
    expect(await codeOf(services.documents.file(IDS.documents.raoLatest))).toBe('not_found');
    const offline = createRealServicesV2({ db, fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch });
    expect(await codeOf(offline.documents.file(IDS.documents.ecg))).toBe('network');
    const { record } = await services.documents.add(IDS.ramesh, pdf('mine'), { source: 'upload' });
    await db.files.delete(record.id);
    expect(await codeOf(services.documents.file(record.id))).toBe('not_found');
  });
});

describe('documents: reassign and remove', () => {
  async function snapshotMentioning(documentId: string, revision: number) {
    const passport = {
      profileId: IDS.ramesh,
      documents: [{ documentId, title: 'Lipid profile', kind: 'lab_report', clinicalDate: '2026-11-12', sha256: '1'.repeat(64), removedAt: null }],
    } as unknown as Passport;
    await db.snapshots.put({ id: `snap-${revision}`, profileId: IDS.ramesh, createdAt: clock.toISOString(), reason: 'print', passport, revision });
  }

  it('remove deletes the record, file, lines and checked values, and marks snapshots', async () => {
    await snapshotMentioning(IDS.documents.lipidProfile, 1);
    await db.snapshots.put({ id: 'snap-other', profileId: IDS.ramesh, createdAt: clock.toISOString(), reason: 'manual', passport: { profileId: IDS.ramesh, documents: [] } as unknown as Passport, revision: 2 });
    const share = (id: string, overrides: object) => ({ id, profileId: IDS.ramesh, snapshotId: 'snap-1', url: `https://x/share/${id}#k`, createdAt: clock.toISOString(), expiresAt: '2026-11-14T12:00:00+05:30', revoked: false, revokeToken: 'secret', ...overrides });
    await db.shares.bulkPut([share('active', {}), share('revoked', { revoked: true }), share('expired', { expiresAt: '2026-11-14T08:00:00+05:30' }), share('other-snapshot', { snapshotId: 'snap-other' })]);
    await db.fieldEvidence.put({ id: 'ev', profileId: IDS.ramesh, documentId: IDS.documents.lipidProfile, field: 'document_date', lineIndex: null, ingredientIndex: null, page: 1, raw: '12/11/2026', value: '2026-11-12', status: 'user_confirmed', reasons: [], source: 'ocr', confidence: 0.9, region: null, reviewedAt: null });
    await db.files.put({ id: IDS.documents.lipidProfile, blob: pdf('lipid') });

    const result = await services.documents.remove(IDS.documents.lipidProfile);
    expect(result.snapshotsMentioning).toEqual(['snap-1']);
    expect(result.activeShares.map((s) => s.id)).toEqual(['active']);
    expect(result.activeShares[0]).not.toHaveProperty('revokeToken');

    expect(await codeOf(services.documents.get(IDS.documents.lipidProfile))).toBe('not_found');
    expect(await db.files.get(IDS.documents.lipidProfile)).toBeUndefined();
    expect(await db.fieldEvidence.get('ev')).toBeUndefined();
    const snapshot = (await db.snapshots.get('snap-1'))!;
    expect(snapshot.passport.documents[0]).toMatchObject({ documentId: IDS.documents.lipidProfile, title: 'Lipid profile', removedAt: clock.toISOString() });
    expect((await db.visits.get(IDS.visit))!.sharedDocumentIds).toEqual([IDS.documents.ecg]);

    await services.documents.remove(IDS.documents.raoLatest);
    expect(await db.prescriptionLines.where('documentId').equals(IDS.documents.raoLatest).count()).toBe(0);
    expect(await codeOf(services.documents.remove('nope'))).toBe('not_found');
  });

  it('assignProfile moves a record and its checked values, and drops the old doctor link', async () => {
    const { record } = await services.documents.add(IDS.ramesh, pdf('wrong patient'), { source: 'email' });
    await services.documents.update(record.id, { prescriberId: IDS.prescribers.rao });
    await db.fieldEvidence.put({ id: 'ev', profileId: IDS.ramesh, documentId: record.id, field: 'patient_name', lineIndex: null, ingredientIndex: null, page: 1, raw: 'Lakshmi Iyer', value: 'Lakshmi Iyer', status: 'extracted', reasons: [], source: 'ocr', confidence: 0.9, region: null, reviewedAt: null });
    const moved = await services.documents.assignProfile(record.id, IDS.lakshmi);
    expect(moved).toMatchObject({ profileId: IDS.lakshmi, prescriberId: null });
    expect((await db.fieldEvidence.get('ev'))!.profileId).toBe(IDS.lakshmi);
    expect((await services.documents.list(IDS.ramesh)).some((d) => d.id === record.id)).toBe(false);
    expect(await services.documents.assignProfile(record.id, IDS.lakshmi)).toEqual(moved);
    expect(await codeOf(services.documents.assignProfile(record.id, 'nobody'))).toBe('not_found');
  });
});

describe('settings, backup and subscribe', () => {
  it('cloud reading setting', async () => {
    expect(await services.settings.get()).toEqual({ cloudReadingAllowed: false });
    await services.settings.setCloudReadingAllowed(true);
    expect(await services.settings.get()).toEqual({ cloudReadingAllowed: true });
  });

  it('backup round trip through the services', async () => {
    await services.documents.add(IDS.ramesh, pdf('kept'), { source: 'upload' });
    const backup = await services.backup.export('a passphrase');
    const other = new CareVaultDbV2(`services-v2-test-restore-${counter}`);
    const restored = createRealServicesV2({ db: other });
    await restored.backup.import(backup, 'a passphrase');
    expect((await restored.documents.list(IDS.ramesh)).length).toBe((await services.documents.list(IDS.ramesh)).length);
    expect(await codeOf(restored.backup.import(backup, 'wrong'))).toBe('bad_passphrase');
    other.close();
    await other.delete();
  });

  it('subscribers hear once per write and never for reads', async () => {
    const listener = vi.fn();
    services.subscribe(listener);
    await services.documents.list(IDS.ramesh);
    await tick();
    expect(listener).not.toHaveBeenCalled();
    await services.documents.add(IDS.ramesh, pdf('z'), { source: 'upload' });
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('detectMimeType, isIsoDate, newestDocumentFirst', () => {
    const bytes = (...b: number[]) => new Uint8Array(b).buffer;
    expect(detectMimeType('', bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(detectMimeType('', bytes(1, 2, 3))).toBeNull();
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    const doc = (id: string, clinicalDate: string | null, addedAt: string) => ({ id, clinicalDate, addedAt }) as DocumentRecord;
    const sorted = [doc('b', null, '2026-01-02T00:00:00Z'), doc('a', '2026-01-01', '2026-01-01T00:00:00Z'), doc('c', null, '2026-01-03T00:00:00Z'), doc('d', '2026-01-01', '2026-01-05T00:00:00Z')].sort(newestDocumentFirst);
    expect(sorted.map((d) => d.id)).toEqual(['d', 'a', 'c', 'b']);
  });
});

describe('drug reference evidence levels', () => {
  it('every entry has a level, and the weaker ones are the documented ones', () => {
    const levels = Object.fromEntries(table.products.map((p) => [p.productName, p.evidence]));
    for (const p of table.products) expect(['manufacturer', 'secondary', 'project']).toContain(p.evidence);
    expect(levels['Dolo 650']).toBe('project');
    expect([levels['Telma 40'], levels['Telma H'], levels['Okacet 10']]).toEqual(['secondary', 'secondary', 'secondary']);
    expect(levels['Combiflam']).toBe('manufacturer');
    expect(table.products.filter((p) => p.evidence === 'manufacturer')).toHaveLength(59);
  });
});

describe('methods of later steps', () => {
  it('reject as not built yet', async () => {
    const pending: [string, () => Promise<unknown>][] = [
      ['documents.fields', () => services.documents.fields('x')],
      ['documents.reviewFields', () => services.documents.reviewFields('x', [])],
      ['reading.read', () => services.reading.read('x', { allowCloud: false })],
      ['prescriptions.save', () => services.prescriptions.save('x', 'y', [])],
      ['routine.list', () => services.routine.list(IDS.ramesh)],
      ['health.list', () => services.health.list(IDS.ramesh)],
      ['attention.list', () => services.attention.list(IDS.ramesh)],
      ['records.search', () => services.records.search(IDS.ramesh, {})],
      ['visits.next', () => services.visits.next(IDS.ramesh)],
      ['passport.live', () => services.passport.live(IDS.ramesh)],
      ['sharing.list', () => services.sharing.list(IDS.ramesh)],
      ['gmail.findCandidates', () => services.gmail.findCandidates(IDS.ramesh)],
    ];
    for (const [name, call] of pending) {
      await expect(call(), name).rejects.toBeInstanceOf(ServiceError);
      await expect(call()).rejects.toMatchObject({ code: 'unknown', message: 'not built yet' });
    }
  });
});
