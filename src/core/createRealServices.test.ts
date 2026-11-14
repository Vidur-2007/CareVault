// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone; jsdom's does not.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expected,
  IDS,
  sampleDocuments,
  sampleMedicines,
  samplePrescribers,
  sampleProfile,
  sampleReviewItems,
  sampleVisit,
} from '../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../contract/services';
import { ServiceError, type ExtractedLine, type MedicineStatus } from '../contract/types';
import { createRealServices, SAMPLE_DOCUMENT_FILES } from './createRealServices';
import { CareVaultDb } from './db/schema';

const M = IDS.medicines;
const D = IDS.documents;
const P = IDS.prescribers;
const R = IDS.reviewItems;
const PROFILE = IDS.profile;

let counter = 0;
let db: CareVaultDb;
let services: CareVaultServices;
let clock: Date;
let idCounter: number;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pdf = (text = 'sample') => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });
const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

const line = (name: string, strength: number, overrides: Partial<ExtractedLine> = {}): ExtractedLine => ({
  productName: `${name} ${strength} mg`,
  ingredients: [{ name, strength, unit: 'mg' }],
  form: 'tablet',
  dosesPerDay: 1,
  instruction: '1 tablet, morning',
  warnings: [],
  ...overrides,
});

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    return error as ServiceError;
  }
  throw new Error('Expected the call to reject');
}

beforeEach(async () => {
  counter += 1;
  idCounter = 0;
  clock = new Date('2026-11-14T09:00:00+05:30');
  db = new CareVaultDb(`carevault-services-test-${counter}`);
  services = createRealServices({
    db,
    now: () => clock,
    newId: () => `id-${(idCounter += 1)}`,
  });
  await services.profiles.loadSampleProfile();
  await tick();
});

afterEach(async () => {
  await db.delete();
});

describe('contract: every built method, against the sample profile', () => {
  it('profiles', async () => {
    expect(await services.profiles.list()).toEqual([sampleProfile]);
    expect(await services.profiles.loadSampleProfile()).toEqual(sampleProfile);
    expect(await services.profiles.list()).toHaveLength(1);
    expect(await services.profiles.prescribers(PROFILE)).toEqual(samplePrescribers);

    const created = await services.profiles.create({
      name: '  Lakshmi Iyer ',
      relation: 'Mother',
      birthYear: null,
      caregiverName: 'Anjali Iyer',
      caregiverRelation: 'daughter',
    });
    expect(created).toEqual({
      id: 'id-1',
      name: 'Lakshmi Iyer',
      relation: 'Mother',
      birthYear: null,
      caregiverName: 'Anjali Iyer',
      caregiverRelation: 'daughter',
      createdAt: clock.toISOString(),
    });
    expect(ids(await services.profiles.list())).toEqual([PROFILE, 'id-1']);
    expect(await services.profiles.prescribers('id-1')).toEqual([]);
  });

  it('medicines', async () => {
    const all = await services.medicines.list(PROFILE);
    expect(all).toHaveLength(sampleMedicines.length);
    const statuses: MedicineStatus[] = ['confirmed_current', 'needs_confirmation', 'found_at_home', 'stopped'];
    for (const status of statuses) {
      const withStatus = all.filter((m) => m.status === status);
      expect(ids(withStatus).sort()).toEqual([...expected.medicineIdsByStatus[status]].sort());
      expect(withStatus).toHaveLength(expected.statusCounts[status]);
    }
    expect(await services.medicines.get(M.dolo650)).toEqual(sampleMedicines.find((m) => m.id === M.dolo650));
    expect((await services.medicines.history(M.amlodipine5)).map((e) => e.type)).toEqual(['added', 'replaced']);
    expect((await services.medicines.history(M.pantoprazole40)).map((e) => e.type)).toEqual(['added', 'marked_stopped']);
  });

  it('ingredient totals: paracetamol 3450 mg a day', async () => {
    expect(await services.medicines.ingredientTotals(PROFILE)).toEqual(expected.ingredientTotals);
  });

  it('documents', async () => {
    expect(ids(await services.documents.list(PROFILE))).toEqual([
      D.hba1c, D.lipidProfile, D.raoLatest, D.ecg, D.raoPrevious, D.menon,
    ]);
    expect(await services.documents.get(D.ecg)).toEqual(sampleDocuments.find((d) => d.id === D.ecg));
    expect(ids(await services.documents.search(PROFILE, 'lipid'))).toEqual([D.lipidProfile]);
    expect(ids(await services.documents.search(PROFILE, ' LAB REPORT '))).toEqual([D.hba1c, D.lipidProfile]);
    expect(ids(await services.documents.search(PROFILE, 'prescription'))).toEqual([D.raoLatest, D.raoPrevious, D.menon]);
    expect(await services.documents.search(PROFILE, '')).toHaveLength(6);
    expect(await services.documents.search(PROFILE, 'x-ray')).toEqual([]);

    expect(await services.documents.star(D.ecg, true)).toMatchObject({ id: D.ecg, starred: true });
    expect((await services.documents.get(D.ecg)).starred).toBe(true);
    expect((await services.documents.star(D.ecg, false)).starred).toBe(false);
  });

  it('prescriptions: the comparison of the two cardiology prescriptions', async () => {
    const diff = await services.prescriptions.latestDiff(PROFILE, P.rao);
    expect(diff).toEqual(expected.diff);
    expect(diff!.rows).toEqual(expected.diffRows);
    const menon = await services.prescriptions.latestDiff(PROFILE, P.menon);
    expect(menon).toMatchObject({ previousDocumentId: null, latestDocumentId: D.menon });
    expect(menon!.rows.map((r) => r.kind)).toEqual(['added']);
    expect(await services.prescriptions.latestDiff(PROFILE, 'nobody')).toBeNull();
  });

  it('review: three open items', async () => {
    const open = await services.review.listOpen(PROFILE);
    expect(ids(open)).toEqual(expected.openReviewItemIds);
    expect(open).toEqual(sampleReviewItems);
  });

  it('visits: next visit, change summary and passport', async () => {
    expect(await services.visits.next(PROFILE)).toEqual(sampleVisit);
    expect(await services.visits.changeSummary(PROFILE)).toEqual(expected.changeSummary);

    const passport = await services.visits.buildPassport(PROFILE);
    expect(passport).toMatchObject({
      patientName: 'Ramesh Iyer',
      patientAge: 71,
      preparedBy: 'Anjali Iyer, daughter',
      preparedOn: '2026-11-14',
      visitAt: sampleVisit.at,
      prescriberName: 'Dr. Kavita Rao',
      prescriberSpecialty: 'Cardiology',
      changesSince: '2026-08-05',
    });
    expect(passport.currentMedicines.map((m) => m.productName)).toEqual([
      'Amlodipine 10 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg', 'Metformin 500 mg',
    ]);
    expect(passport.changes.map((c) => c.kind)).toEqual(['added', 'changed', 'unconfirmed']);
    expect(passport.flags).toHaveLength(1);
    expect(passport.documents.map((d) => d.title)).toEqual(['Lipid profile', 'ECG report']);
    expect(passport.questions).toEqual(sampleVisit.questions.map((q) => q.text));
  });

  it('visits: questions, shared documents and saving', async () => {
    const asked = await services.visits.addQuestion(IDS.visit, '  Is the new dose right? ');
    expect(asked.questions.at(-1)).toEqual({ id: 'id-1', text: 'Is the new dose right?', source: 'manual' });
    expect((await services.visits.addQuestion(IDS.visit, 'is the new dose right?')).questions).toHaveLength(3);
    const removed = await services.visits.removeQuestion(IDS.visit, 'id-1');
    expect(removed.questions).toEqual(sampleVisit.questions);

    const shared = await services.visits.setSharedDocuments(IDS.visit, [D.ecg, D.ecg, 'not-a-document', D.hba1c]);
    expect(shared.sharedDocumentIds).toEqual([D.ecg, D.hba1c]);
    expect((await services.visits.next(PROFILE))!.sharedDocumentIds).toEqual([D.ecg, D.hba1c]);

    const moved = await services.visits.save({ ...sampleVisit, at: '2026-11-20T16:00:00+05:30' });
    expect(moved).toEqual({ ...sampleVisit, at: '2026-11-20T16:00:00+05:30' });
    const added = await services.visits.save({
      profileId: PROFILE,
      prescriberId: P.menon,
      at: '2026-11-16T09:00:00+05:30',
      questions: [],
      sharedDocumentIds: [],
    });
    expect(added.id).toBe('id-2');
    expect((await services.visits.next(PROFILE))!.id).toBe('id-2');
  });

  it('settings', async () => {
    expect(await services.settings.get()).toEqual({ cloudReadingAllowed: false });
    await services.settings.setCloudReadingAllowed(true);
    expect(await services.settings.get()).toEqual({ cloudReadingAllowed: true });
    await services.settings.setCloudReadingAllowed(false);
    expect(await services.settings.get()).toEqual({ cloudReadingAllowed: false });
  });

  it('subscribe fires once per write, never for reads, and can be cancelled', async () => {
    const listener = vi.fn();
    const unsubscribe = services.subscribe(listener);
    await services.medicines.list(PROFILE);
    await services.visits.buildPassport(PROFILE);
    await tick();
    expect(listener).not.toHaveBeenCalled();

    await services.review.resolve(R.confirmAtorvastatin, 'still_taking');
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);

    await services.settings.setCloudReadingAllowed(true);
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await services.documents.star(D.ecg, true);
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('the group that is not built yet rejects with a ServiceError', async () => {
    const pending = [
      () => services.gmail.connect(),
      () => services.gmail.findCandidates(),
      () => services.gmail.importAttachment(PROFILE, 'message'),
    ];
    for (const call of pending) {
      const error = await rejection(call());
      expect(error.code).toBe('unknown');
      expect(error.message).toBe('not built yet');
    }
  });
});

describe('medicines through the service', () => {
  it('a scanned pack is found at home and opens a duplicate question when it shares an ingredient', async () => {
    const added = await services.medicines.addFromLine(
      PROFILE,
      line('Paracetamol IP', 500, { productName: 'Calpol 500', dosesPerDay: null, warnings: ['How often it is taken was not found on the pack.'] }),
      { origin: 'home_scan', documentId: null },
    );
    expect(added).toMatchObject({
      id: 'id-1',
      productName: 'Calpol 500',
      ingredients: [{ name: 'paracetamol', strength: 500, unit: 'mg' }],
      status: 'found_at_home',
      fieldState: 'extracted',
      prescriberId: null,
      createdAt: clock.toISOString(),
    });
    expect((await services.medicines.history(added.id)).map((e) => e.type)).toEqual(['added']);

    // Three products now share paracetamol: one question about all three replaces the old one.
    const duplicates = (await services.review.listOpen(PROFILE)).filter((r) => r.kind === 'possible_duplicate');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].medicineIds).toEqual([M.dolo650, M.crocinAdvance500, added.id]);
    expect(duplicates[0].title).toBe('Three products at home contain paracetamol');

    const [total] = await services.medicines.ingredientTotals(PROFILE);
    expect(total.complete).toBe(false);
    expect(total.perDay).toBe(0);
    expect(total.parts.map((p) => p.perDay)).toEqual([1950, 1500, 0]);
  });

  it('a medicine added from a document takes that document\'s prescriber', async () => {
    const added = await services.medicines.addFromLine(PROFILE, line('Aspirin', 75), { origin: 'prescription', documentId: D.raoLatest });
    expect(added).toMatchObject({ prescriberId: P.rao, sourceDocumentId: D.raoLatest, status: 'confirmed_current' });
    expect((await rejection(services.medicines.addFromLine(PROFILE, line('Aspirin', 75), { origin: 'manual', documentId: 'nope' }))).code).toBe('not_found');
  });

  it('confirming a scanned medicine, with a correction', async () => {
    const confirmed = await services.medicines.confirm(M.dolo650, { dosesPerDay: 2, instruction: '1 tablet, twice a day' });
    expect(confirmed).toMatchObject({ status: 'confirmed_current', fieldState: 'confirmed', dosesPerDay: 2, updatedAt: clock.toISOString() });
    expect((await services.medicines.history(M.dolo650)).map((e) => e.type)).toEqual(['added', 'confirmed']);
    expect((await services.medicines.ingredientTotals(PROFILE))[0].perDay).toBe(2800);
    expect((await services.medicines.confirm(M.crocinAdvance500)).status).toBe('confirmed_current');
  });

  it('stopping one of two duplicates removes the duplicate question', async () => {
    const stopped = await services.medicines.setStatus(M.crocinAdvance500, 'stopped');
    expect(stopped.status).toBe('stopped');
    expect(await services.medicines.ingredientTotals(PROFILE)).toEqual([]);
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.confirmAtorvastatin, R.newDocumentHba1c]);
    expect((await services.visits.buildPassport(PROFILE)).flags).toEqual([]);
  });

  it('setting the same status changes nothing and adds no history', async () => {
    const before = await services.medicines.get(M.dolo650);
    expect(await services.medicines.setStatus(M.dolo650, 'found_at_home')).toEqual(before);
    expect(await services.medicines.history(M.dolo650)).toHaveLength(1);
  });
});

describe('documents through the service', () => {
  it('stores the file, starts unconfirmed, and detects an exact duplicate by hash', async () => {
    const file = pdf('lipid profile november');
    const first = await services.documents.add(PROFILE, file, {
      type: 'lab_report', title: ' Lipid profile ', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    expect(first.duplicateOf).toBeNull();
    expect(first.record).toMatchObject({
      id: 'id-1',
      profileId: PROFILE,
      title: 'Lipid profile',
      state: 'pending_confirmation',
      starred: false,
      mimeType: 'application/pdf',
      addedAt: clock.toISOString(),
    });
    expect(first.record.sha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = await services.documents.file(first.record.id);
    expect(stored.type).toBe('application/pdf');
    expect(await stored.text()).toBe('%PDF-1.4 lipid profile november');

    clock = new Date('2026-11-14T10:00:00+05:30');
    const again = await services.documents.add(PROFILE, pdf('lipid profile november'), {
      type: 'lab_report', title: 'Lipid profile (copy)', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    expect(again.duplicateOf).toBe(first.record.id);
    expect(again.record.sha256).toBe(first.record.sha256);
    const third = await services.documents.add(PROFILE, pdf('lipid profile november'), {
      type: 'lab_report', title: 'Third copy', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    expect(third.duplicateOf).toBe(first.record.id);

    const different = await services.documents.add(PROFILE, pdf('another file'), {
      type: 'other', title: 'Other', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    expect(different.duplicateOf).toBeNull();
    // An upload waits for confirmation on its own screen, not in the review inbox.
    expect(ids(await services.review.listOpen(PROFILE))).toEqual(expected.openReviewItemIds);
  });

  it('does not treat another profile\'s file as a duplicate', async () => {
    const other = await services.profiles.create({ name: 'Lakshmi', relation: 'Mother', birthYear: null, caregiverName: 'Anjali', caregiverRelation: 'daughter' });
    const meta = { type: 'other' as const, title: 'Scan', documentDate: '2026-11-13', source: 'upload' as const, prescriberId: null };
    await services.documents.add(PROFILE, pdf('same bytes'), meta);
    expect((await services.documents.add(other.id, pdf('same bytes'), meta)).duplicateOf).toBeNull();
  });

  it('recognises a file by its first bytes when the browser gives no type', async () => {
    const meta = { type: 'other' as const, title: 'Scan', documentDate: '2026-11-13', source: 'scan' as const, prescriberId: null };
    const untypedPdf = await services.documents.add(PROFILE, new Blob(['%PDF-1.7 untyped']), meta);
    expect(untypedPdf.record.mimeType).toBe('application/pdf');
    expect((await services.documents.file(untypedPdf.record.id)).type).toBe('application/pdf');
    const jpeg = await services.documents.add(PROFILE, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])]), meta);
    expect(jpeg.record.mimeType).toBe('image/jpeg');
    const png = await services.documents.add(PROFILE, new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])]), meta);
    expect(png.record.mimeType).toBe('image/png');
    const heic = await services.documents.add(PROFILE, new Blob(['anything'], { type: 'image/heic' }), meta);
    expect(heic.record.mimeType).toBe('image/heic');
  });

  it('rejects an empty file or one that is neither a photo nor a PDF', async () => {
    const meta = { type: 'other' as const, title: 'Scan', documentDate: '2026-11-13', source: 'upload' as const, prescriberId: null };
    expect((await rejection(services.documents.add(PROFILE, new Blob(['plain text'], { type: 'text/plain' }), meta))).code).toBe('unsupported_file');
    expect((await rejection(services.documents.add(PROFILE, new Blob([]), meta))).code).toBe('unsupported_file');
    expect((await rejection(services.documents.add(PROFILE, new Blob([], { type: 'application/pdf' }), meta))).code).toBe('unsupported_file');
    expect(await services.documents.list(PROFILE)).toHaveLength(6);
  });

  it('confirming the emailed report closes its question', async () => {
    expect((await services.documents.confirm(D.hba1c)).state).toBe('confirmed');
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.confirmAtorvastatin, R.duplicateParacetamol]);
    expect((await services.documents.confirm(D.hba1c)).state).toBe('confirmed');
  });

  it('removing a document removes its file, lines and its place on the visit', async () => {
    const { record } = await services.documents.add(PROFILE, pdf('to remove'), {
      type: 'test', title: 'Echo report', documentDate: '2026-11-13', source: 'upload', prescriberId: null,
    });
    await services.visits.setSharedDocuments(IDS.visit, [D.lipidProfile, record.id]);
    await services.documents.remove(record.id);
    expect((await rejection(services.documents.get(record.id))).code).toBe('not_found');
    expect((await rejection(services.documents.file(record.id))).code).toBe('not_found');
    expect(await db.files.count()).toBe(0);
    expect((await services.visits.next(PROFILE))!.sharedDocumentIds).toEqual([D.lipidProfile]);

    await services.documents.remove(D.raoLatest);
    expect(await db.prescriptionLines.where('documentId').equals(D.raoLatest).count()).toBe(0);
    const diff = await services.prescriptions.latestDiff(PROFILE, P.rao);
    expect(diff).toMatchObject({ latestDocumentId: D.raoPrevious, previousDocumentId: null });

    await services.documents.remove(D.hba1c);
    expect(ids(await services.review.listOpen(PROFILE))).not.toContain(R.newDocumentHba1c);
  });

  it('a sample document is loaded from the files that ship with the app', async () => {
    const asked: string[] = [];
    const withFetch = createRealServices({
      db,
      fetch: async (url) => {
        asked.push(String(url));
        return String(url).includes('ecg') ? new Response('%PDF-sample') : new Response('', { status: 404 });
      },
    });
    const file = await withFetch.documents.file(D.ecg);
    expect(asked).toEqual(['/sample-docs/ecg-report-2026-09-15.pdf']);
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-sample');
    expect((await rejection(withFetch.documents.file(D.menon))).code).toBe('not_found');

    const offline = createRealServices({ db, fetch: async () => { throw new TypeError('offline'); } });
    expect((await rejection(offline.documents.file(D.ecg))).code).toBe('network');
  });

  it('every sample document has a file in public/sample-docs', async () => {
    // @ts-expect-error Node built-in: the app's tsconfig has no Node types.
    const { existsSync } = await import('node:fs');
    for (const doc of sampleDocuments) {
      expect(existsSync(`public/sample-docs/${SAMPLE_DOCUMENT_FILES[doc.id]}`)).toBe(true);
    }
  });
});

describe('review resolutions through the service', () => {
  it('still taking: Atorvastatin is confirmed', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'still_taking');
    expect(await services.medicines.get(M.atorvastatin10)).toMatchObject({ status: 'confirmed_current', updatedAt: clock.toISOString() });
    expect((await services.medicines.history(M.atorvastatin10)).map((e) => e.type)).toEqual(['added', 'flagged_for_review', 'confirmed']);
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.duplicateParacetamol, R.newDocumentHba1c]);
    expect((await services.visits.changeSummary(PROFILE))!.toConfirm).toBe(0);
    expect((await services.visits.buildPassport(PROFILE)).currentMedicines.map((m) => m.productName)).toContain('Atorvastatin 10 mg');
    // The diff still shows the row, linked to the answered question.
    const diff = await services.prescriptions.latestDiff(PROFILE, P.rao);
    expect(diff!.rows[2]).toMatchObject({ kind: 'review', reviewItemId: R.confirmAtorvastatin });
  });

  it('stopped: Atorvastatin is stopped, by the caregiver and never by the app', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'stopped');
    expect((await services.medicines.get(M.atorvastatin10)).status).toBe('stopped');
    expect((await services.medicines.history(M.atorvastatin10)).at(-1)).toMatchObject({
      type: 'marked_stopped',
      detail: 'Marked as stopped by the caregiver',
    });
    expect((await services.visits.buildPassport(PROFILE)).changes.map((c) => c.kind)).toEqual(['added', 'changed']);
  });

  it('ask the doctor: status unchanged, resolved in the inbox, unconfirmed on the passport', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'ask_doctor');
    expect((await services.medicines.get(M.atorvastatin10)).status).toBe('needs_confirmation');
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.duplicateParacetamol, R.newDocumentHba1c]);
    const passport = await services.visits.buildPassport(PROFILE);
    expect(passport.changes.at(-1)).toEqual({ kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not on the 28 Oct prescription' });
    // The visit already asks about Atorvastatin, so no second question is added.
    expect((await services.visits.next(PROFILE))!.questions).toEqual(sampleVisit.questions);
  });

  it('ask the doctor adds a question when the visit has none about it', async () => {
    for (const question of sampleVisit.questions) await services.visits.removeQuestion(IDS.visit, question.id);
    await services.review.resolve(R.confirmAtorvastatin, 'ask_doctor');
    await services.review.resolve(R.duplicateParacetamol, 'ask_doctor');
    expect((await services.visits.next(PROFILE))!.questions).toEqual([
      { id: expect.any(String), text: 'Does Rosuvastatin replace Atorvastatin, or should he take both?', source: 'review' },
      { id: expect.any(String), text: 'Can he use Dolo 650 and Crocin Advance 500 on the same day? Both contain paracetamol.', source: 'review' },
    ]);
    // Parked for the doctor: still flagged on the passport.
    expect((await services.visits.buildPassport(PROFILE)).flags).toHaveLength(1);
    expect(await services.review.listOpen(PROFILE)).toHaveLength(1);
  });

  it('only one: the other product is stopped', async () => {
    await services.review.resolve(R.duplicateParacetamol, 'only_one', { keepMedicineId: M.dolo650 });
    expect((await services.medicines.get(M.dolo650)).status).toBe('found_at_home');
    expect((await services.medicines.get(M.crocinAdvance500)).status).toBe('stopped');
    expect(await services.medicines.ingredientTotals(PROFILE)).toEqual([]);
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.confirmAtorvastatin, R.newDocumentHba1c]);
  });

  it('only one without a choice is refused and changes nothing', async () => {
    const listener = vi.fn();
    services.subscribe(listener);
    const error = await rejection(services.review.resolve(R.duplicateParacetamol, 'only_one'));
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('Please choose which product is taken.');
    await tick();
    expect(listener).not.toHaveBeenCalled();
    expect((await services.medicines.get(M.crocinAdvance500)).status).toBe('found_at_home');
    expect(await services.review.listOpen(PROFILE)).toHaveLength(3);
  });

  it('added: the emailed report is confirmed', async () => {
    await services.review.resolve(R.newDocumentHba1c, 'added');
    expect((await services.documents.get(D.hba1c)).state).toBe('confirmed');
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.confirmAtorvastatin, R.duplicateParacetamol]);
  });

  it('dismissed: the emailed report is removed', async () => {
    await services.review.resolve(R.newDocumentHba1c, 'dismissed');
    expect((await rejection(services.documents.get(D.hba1c))).code).toBe('not_found');
    expect(await services.documents.list(PROFILE)).toHaveLength(5);
    expect((await services.visits.changeSummary(PROFILE))!.newDocuments).toBe(1);
    expect(await services.review.listOpen(PROFILE)).toHaveLength(2);
  });

  it('dismissing a duplicate keeps both products and does not ask again', async () => {
    await services.review.resolve(R.duplicateParacetamol, 'dismissed');
    await services.medicines.confirm(M.dolo650);
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.confirmAtorvastatin, R.newDocumentHba1c]);
    expect((await services.visits.buildPassport(PROFILE)).flags).toEqual([]);
    expect(await services.medicines.ingredientTotals(PROFILE)).toHaveLength(1);
  });

  it('resolving twice does nothing the second time', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'still_taking');
    await services.review.resolve(R.confirmAtorvastatin, 'stopped');
    expect((await services.medicines.get(M.atorvastatin10)).status).toBe('confirmed_current');
  });
});

describe('reversing an answer by setting the status', () => {
  it('stopped, then back to needing confirmation: the question is open again', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'stopped');
    expect((await services.medicines.get(M.atorvastatin10)).status).toBe('stopped');

    clock = new Date('2026-11-14T09:00:05+05:30');
    const restored = await services.medicines.setStatus(M.atorvastatin10, 'needs_confirmation');
    expect(restored.status).toBe('needs_confirmation');
    const open = await services.review.listOpen(PROFILE);
    const reopened = open.filter((r) => r.kind === 'confirm_medicine');
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ medicineIds: [M.atorvastatin10], title: 'Is he still taking Atorvastatin 10 mg?' });
    expect((await services.visits.changeSummary(PROFILE))!.toConfirm).toBe(1);
    expect((await services.medicines.history(M.atorvastatin10)).map((e) => e.type)).toEqual([
      'added', 'flagged_for_review', 'marked_stopped', 'flagged_for_review',
    ]);
  });

  it('still taking, then stopped directly', async () => {
    await services.review.resolve(R.confirmAtorvastatin, 'still_taking');
    await services.medicines.setStatus(M.atorvastatin10, 'stopped');
    expect((await services.medicines.get(M.atorvastatin10)).status).toBe('stopped');
    expect((await services.visits.buildPassport(PROFILE)).currentMedicines.map((m) => m.productName)).not.toContain('Atorvastatin 10 mg');
  });

  it('only one, then the stopped product is put back: the duplicate is asked about again', async () => {
    await services.review.resolve(R.duplicateParacetamol, 'only_one', { keepMedicineId: M.dolo650 });
    await services.medicines.setStatus(M.crocinAdvance500, 'found_at_home');
    const open = await services.review.listOpen(PROFILE);
    expect(open.filter((r) => r.kind === 'possible_duplicate')).toHaveLength(1);
    expect(await services.medicines.ingredientTotals(PROFILE)).toEqual(expected.ingredientTotals);
  });

  it('changing the status directly closes the open question with that answer', async () => {
    await services.medicines.setStatus(M.atorvastatin10, 'stopped');
    expect(ids(await services.review.listOpen(PROFILE))).toEqual([R.duplicateParacetamol, R.newDocumentHba1c]);
    const item = await db.reviewItems.get(R.confirmAtorvastatin);
    expect(item).toMatchObject({ resolution: 'stopped', resolvedAt: clock.toISOString() });
  });
});

describe('a new prescription through the service', () => {
  const lines = [
    line('Amlodipine', 10),
    line('Telmisartan', 80),
    line('Rosuvastatin', 10, { instruction: '1 tablet, night' }),
    line('Aspirin', 75, { instruction: '1 tablet, after lunch' }),
  ];

  async function upload() {
    const { record } = await services.documents.add(PROFILE, pdf('rao november'), {
      type: 'prescription', title: 'Cardiology prescription', documentDate: '2026-11-13', source: 'scan', prescriberId: P.rao,
    });
    return record;
  }

  it('returns the comparison and reads the same one back', async () => {
    const record = await upload();
    const diff = await services.prescriptions.apply(PROFILE, record.id, P.rao, lines);
    expect(diff).toMatchObject({ prescriberId: P.rao, previousDocumentId: D.raoLatest, latestDocumentId: record.id });
    expect(diff.rows.map((r) => [r.kind, r.latest?.productName ?? r.previous?.productName, r.note])).toEqual([
      ['added', 'Aspirin 75 mg', 'New on this prescription'],
      ['changed', 'Telmisartan 80 mg', '40 mg to 80 mg'],
      ['unchanged', 'Amlodipine 10 mg', ''],
      ['unchanged', 'Rosuvastatin 10 mg', ''],
    ]);
    expect(diff.rows.every((r) => r.latest?.fieldState === 'confirmed')).toBe(true);
    expect(await services.prescriptions.latestDiff(PROFILE, P.rao)).toEqual(diff);
  });

  it('updates the medicine list: replaces Telmisartan, adds Aspirin, leaves the rest', async () => {
    const before = await services.medicines.list(PROFILE);
    const record = await upload();
    await services.prescriptions.apply(PROFILE, record.id, P.rao, lines);
    const after = await services.medicines.list(PROFILE);
    expect(after).toHaveLength(before.length + 2);

    const telmisartan80 = after.find((m) => m.productName === 'Telmisartan 80 mg')!;
    expect(telmisartan80).toMatchObject({ status: 'confirmed_current', prescriberId: P.rao, sourceDocumentId: record.id });
    expect(await services.medicines.get(M.telmisartan40)).toMatchObject({ status: 'stopped', replacedByMedicineId: telmisartan80.id });
    expect((await services.medicines.history(telmisartan80.id)).map((e) => [e.type, e.detail])).toEqual([['strength_changed', '40 mg to 80 mg']]);
    expect(after.find((m) => m.productName === 'Aspirin 75 mg')).toMatchObject({ status: 'confirmed_current' });

    // Untouched: the other prescriber, the home scans, and the open Atorvastatin question.
    for (const id of [M.metformin500, M.dolo650, M.crocinAdvance500, M.atorvastatin10, M.amlodipine10, M.rosuvastatin10]) {
      expect(after.find((m) => m.id === id)).toEqual(before.find((m) => m.id === id));
    }
    expect(ids(await services.review.listOpen(PROFILE))).toEqual(expected.openReviewItemIds);
    expect(await services.visits.changeSummary(PROFILE)).toEqual({
      since: '2026-11-13', added: 1, changed: 1, toConfirm: 0, newDocuments: 0,
    });
  });

  it('a medicine missing from the new prescription becomes a question, not a stop', async () => {
    const record = await upload();
    const diff = await services.prescriptions.apply(PROFILE, record.id, P.rao, [line('Amlodipine', 10), line('Telmisartan', 40)]);
    const review = diff.rows.find((r) => r.kind === 'review')!;
    expect(review.previous!.productName).toBe('Rosuvastatin 10 mg');
    expect(review.reviewItemId).not.toBeNull();
    expect((await services.medicines.get(M.rosuvastatin10)).status).toBe('needs_confirmation');
    const open = await services.review.listOpen(PROFILE);
    expect(open.find((r) => r.id === review.reviewItemId)).toMatchObject({
      kind: 'confirm_medicine',
      title: 'Is he still taking Rosuvastatin 10 mg?',
      documentId: record.id,
    });
  });

  it('applying it twice changes nothing the second time', async () => {
    const record = await upload();
    const first = await services.prescriptions.apply(PROFILE, record.id, P.rao, lines);
    const medicines = await services.medicines.list(PROFILE);
    const events = await db.events.count();
    expect(await services.prescriptions.apply(PROFILE, record.id, P.rao, lines)).toEqual(first);
    expect(await services.prescriptions.apply(PROFILE, record.id, P.menon, [line('Metformin', 1000)])).toEqual(first);
    expect(await services.medicines.list(PROFILE)).toEqual(medicines);
    expect(await db.events.count()).toBe(events);
  });

  it('files an untyped upload as a prescription from the chosen prescriber', async () => {
    const { record } = await services.documents.add(PROFILE, pdf('menon november'), {
      type: 'other', title: 'Scan', documentDate: '2026-11-13', source: 'scan', prescriberId: null,
    });
    const diff = await services.prescriptions.apply(PROFILE, record.id, P.menon, [line('Metformin', 1000, { dosesPerDay: 2 })]);
    expect(diff).toMatchObject({ prescriberId: P.menon, previousDocumentId: D.menon });
    expect(diff.rows.map((r) => [r.kind, r.note])).toEqual([['changed', '500 mg to 1000 mg']]);
    expect(await services.documents.get(record.id)).toMatchObject({ type: 'prescription', prescriberId: P.menon });
    expect((await services.medicines.get(M.metformin500)).status).toBe('stopped');
    // Dr. Rao's medicines are not part of this comparison.
    expect((await services.medicines.get(M.amlodipine10)).status).toBe('confirmed_current');
  });

  it('rejects an empty prescription, an unknown document or prescriber, and stores nothing', async () => {
    const record = await upload();
    expect((await rejection(services.prescriptions.apply(PROFILE, record.id, P.rao, []))).code).toBe('unknown');
    expect((await rejection(services.prescriptions.apply(PROFILE, 'nope', P.rao, lines))).code).toBe('not_found');
    expect((await rejection(services.prescriptions.apply(PROFILE, record.id, 'dr-nobody', lines))).code).toBe('not_found');
    expect((await rejection(services.prescriptions.apply('no-profile', record.id, P.rao, lines))).code).toBe('not_found');
    expect(await db.prescriptionLines.where('documentId').equals(record.id).count()).toBe(0);
    expect(await services.medicines.list(PROFILE)).toHaveLength(sampleMedicines.length);
  });
});

describe('errors and clocks', () => {
  it('unknown ids reject with not_found', async () => {
    const calls = [
      () => services.medicines.get('nope'),
      () => services.medicines.history('nope'),
      () => services.medicines.confirm('nope'),
      () => services.medicines.setStatus('nope', 'stopped'),
      () => services.medicines.addFromLine('no-profile', line('Aspirin', 75), { origin: 'manual', documentId: null }),
      () => services.documents.get('nope'),
      () => services.documents.confirm('nope'),
      () => services.documents.remove('nope'),
      () => services.documents.star('nope', true),
      () => services.documents.file('nope'),
      () => services.documents.add('no-profile', pdf(), { type: 'other', title: 'x', documentDate: '2026-11-13', source: 'upload', prescriberId: null }),
      () => services.review.resolve('nope', 'dismissed'),
      () => services.visits.next('no-profile'),
      () => services.visits.addQuestion('nope', 'A question?'),
      () => services.visits.removeQuestion('nope', 'q'),
      () => services.visits.setSharedDocuments('nope', []),
      () => services.visits.changeSummary('no-profile'),
      () => services.visits.buildPassport('no-profile'),
      () => services.visits.save({ ...sampleVisit, profileId: 'no-profile' }),
      () => services.visits.save({ ...sampleVisit, prescriberId: 'dr-nobody' }),
      () => services.prescriptions.latestDiff('no-profile', P.rao),
    ];
    for (const call of calls) expect((await rejection(call())).code).toBe('not_found');
  });

  it('invalid input rejects with a ServiceError and a readable message', async () => {
    expect((await rejection(services.profiles.create({ name: '  ', relation: '', birthYear: null, caregiverName: '', caregiverRelation: '' }))).message).toBe('Please enter a name.');
    expect((await rejection(services.visits.addQuestion(IDS.visit, '   '))).message).toBe('Please type a question first.');
    expect((await rejection(services.visits.save({ ...sampleVisit, at: 'tomorrow' }))).code).toBe('unknown');
  });

  it('wraps unexpected failures in a ServiceError', async () => {
    db.close();
    const broken = createRealServices({ db: { ...db, tables: [] } as unknown as CareVaultDb });
    const error = await rejection(broken.profiles.list());
    expect(error.code).toBe('unknown');
    expect(error.message).not.toBe('');
  });

  it('lists are empty for a profile with nothing in it', async () => {
    const other = await services.profiles.create({ name: 'Lakshmi', relation: 'Mother', birthYear: 1958, caregiverName: 'Anjali', caregiverRelation: 'daughter' });
    expect(await services.medicines.list(other.id)).toEqual([]);
    expect(await services.medicines.ingredientTotals(other.id)).toEqual([]);
    expect(await services.documents.list(other.id)).toEqual([]);
    expect(await services.review.listOpen(other.id)).toEqual([]);
    expect(await services.visits.next(other.id)).toBeNull();
    expect(await services.visits.changeSummary(other.id)).toBeNull();
    expect(await services.prescriptions.latestDiff(other.id, P.rao)).toBeNull();
    expect(await services.visits.buildPassport(other.id)).toMatchObject({
      patientName: 'Lakshmi', patientAge: 68, visitAt: null, currentMedicines: [], changes: [], flags: [],
    });
  });

  it('the sample profile keeps its own calendar; other profiles follow the device clock', async () => {
    clock = new Date('2027-01-15T09:00:00+05:30');
    // Long after 18 November the sample visit is still "next" and the passport still says 14 November.
    expect(await services.visits.next(PROFILE)).toEqual(sampleVisit);
    expect((await services.visits.buildPassport(PROFILE)).preparedOn).toBe('2026-11-14');

    const other = await services.profiles.create({ name: 'Lakshmi', relation: 'Mother', birthYear: 1958, caregiverName: 'Anjali', caregiverRelation: 'daughter' });
    await db.prescribers.put({ id: 'dr-x', profileId: other.id, name: 'Dr. X', specialty: 'General' });
    const past = await services.visits.save({ profileId: other.id, prescriberId: 'dr-x', at: '2027-01-10T10:00:00+05:30', questions: [], sharedDocumentIds: [] });
    expect(await services.visits.next(other.id)).toBeNull();
    const upcoming = await services.visits.save({ profileId: other.id, prescriberId: 'dr-x', at: '2027-01-20T10:00:00+05:30', questions: [], sharedDocumentIds: [] });
    expect((await services.visits.next(other.id))!.id).toBe(upcoming.id);
    expect(past.id).not.toBe(upcoming.id);
    const passport = await services.visits.buildPassport(other.id);
    expect(passport.patientAge).toBe(69);
    expect(passport.preparedOn).toMatch(/^2027-01-1[45]$/);
  });

  it('uses the device clock and random ids by default', async () => {
    const real = createRealServices({ db });
    const profile = await real.profiles.create({ name: 'Default', relation: '', birthYear: null, caregiverName: '', caregiverRelation: '' });
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(Date.parse(profile.createdAt) - Date.now())).toBeLessThan(5000);
    const added = await real.medicines.addFromLine(profile.id, line('Aspirin', 75), { origin: 'manual', documentId: null });
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
