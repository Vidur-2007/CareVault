// @vitest-environment node
// The live passport, snapshots and visits through the services (core step 8). Sharing is
// tested end to end against the real server routes in server/e2e-v2.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expected, IDS, SAMPLE_TODAY } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import type { ServiceError } from '../../contract/types';
import { createRealServicesV2 } from './createRealServicesV2';
import { CareVaultDbV2 } from './db/schema';
import { DUPLICATE_WORDING } from './rules/attention';
import { UNCONFIRMED_REASONS } from './rules/passport';

const D = IDS.documents;
const M = IDS.medicines;
const P = IDS.prescribers;

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;
let ms: number;

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);
const pdf = (text: string) => new Blob([`%PDF-1.4 ${text}`], { type: 'application/pdf' });

beforeEach(async () => {
  ms = Date.parse('2026-11-14T09:00:00+05:30');
  let ids = 0;
  db = new CareVaultDbV2(`passport-v2-test-${(counter += 1)}`);
  services = createRealServicesV2({ db, now: () => new Date((ms += 1000)), newId: () => `id-${(ids += 1)}` });
  await services.profiles.loadSampleProfile();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('the live passport', () => {
  it('Ramesh, exactly as the sample case expects', async () => {
    const live = await services.passport.live(IDS.ramesh);
    const want = expected.ramesh.passport;
    expect(live).toMatchObject({
      profileId: IDS.ramesh, patientName: 'Ramesh Iyer', patientAge: want.patientAge, preparedBy: want.preparedBy, preparedOn: want.preparedOn,
      emergencyContact: 'Anjali Iyer, +91 90000 00000', visit: want.visit, allergies: want.allergies, conditions: want.conditions, procedures: [], questions: want.questions,
    });
    expect(live.currentMedicines.map((m) => m.productName)).toEqual(want.currentMedicineNames);
    expect(live.unconfirmed).toEqual([{ productName: 'Atorvastatin 10 mg', reason: UNCONFIRMED_REASONS.uncertain }]);
    expect(live.documents.map((d) => d.title)).toEqual(want.documentTitles);
    expect(live.documents[0]).toMatchObject({ documentId: D.lipidProfile, kind: 'lab_report', clinicalDate: '2026-11-12', removedAt: null, sha256: expect.any(String) });
    expect(live.currentMedicines[0]).toEqual({
      productName: 'Amlodipine 10 mg', ingredientsText: 'Amlodipine 10 mg', instruction: '1 tablet, morning',
      prescriberName: 'Dr. Kavita Rao', source: 'caregiver_reported', lastConfirmedOn: '2026-10-30',
    });
    expect(live.currentMedicines.find((m) => m.productName === 'Dolo 650')).toMatchObject({ prescriberName: null, source: 'from_pack' });
    expect(live.flags).toEqual([`Paracetamol in Dolo 650 and Crocin Advance 500. ${DUPLICATE_WORDING}`]);
  });

  it('recent changes: the last 90 days, newest first, a replacement told once', async () => {
    const live = await services.passport.live(IDS.ramesh);
    expect(live.recentChanges).toEqual([
      { kind: 'started', text: 'Started Crocin Advance 500', on: '2026-11-10' },
      { kind: 'started', text: 'Started Dolo 650', on: '2026-11-10' },
      { kind: 'started', text: 'Started Rosuvastatin 10 mg', on: '2026-10-30' },
      { kind: 'changed', text: 'Amlodipine 5 mg replaced by Amlodipine 10 mg', on: '2026-10-30' },
    ]);
    // Older than 90 days before the sample's today: left out.
    expect(live.recentChanges.some((c) => c.on < '2026-08-16')).toBe(false);
  });

  it('changes recorded now appear, and an undone change disappears', async () => {
    await services.routine.update(M.metformin500, { dosesPerDay: 3 });
    const stopped = await services.routine.setStatus(M.crocinAdvance500, 'stopped');
    let changes = (await services.passport.live(IDS.ramesh)).recentChanges;
    expect(changes.slice(0, 2).map((c) => [c.kind, c.text])).toEqual([
      ['stopped', 'Stopped Crocin Advance 500'],
      ['changed', 'Metformin 500 mg: 2 a day to 3 a day'],
    ]);
    const [stopEvent] = await services.routine.history(stopped.id);
    await services.routine.undo(stopEvent.id);
    changes = (await services.passport.live(IDS.ramesh)).recentChanges;
    expect(changes.some((c) => c.text === 'Stopped Crocin Advance 500')).toBe(false);
    // The only taken medicines are on it; stopped and not-started entries are not.
    await services.routine.setStatus(M.dolo650, 'not_started');
    const live = await services.passport.live(IDS.ramesh);
    expect(live.currentMedicines.some((m) => m.productName === 'Dolo 650')).toBe(false);
    expect(live.unconfirmed.some((m) => m.productName === 'Dolo 650')).toBe(false);
    expect(live.recentChanges[0]).toMatchObject({ kind: 'not_started', text: 'Dolo 650: prescribed, not started' });
    expect(live.flags).toEqual([]);
  });

  it('orders current medicines by the visit doctor, other doctors, then none', async () => {
    // Move the visit to Dr. Menon: his medicines come first.
    await services.visits.save({ ...(await services.visits.next(IDS.ramesh))!, prescriberId: P.menon });
    const names = (await services.passport.live(IDS.ramesh)).currentMedicines.map((m) => m.productName);
    expect(names).toEqual(['Metformin 500 mg', 'Amlodipine 10 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg', 'Crocin Advance 500', 'Dolo 650']);
  });

  it('migrated entries waiting for review are unconfirmed, never current', async () => {
    const base = await services.routine.get(M.amlodipine10);
    await db.routine.put({ ...base, id: 'legacy', productName: 'Old tablet', legacyReviewPending: true, source: 'legacy' });
    const live = await services.passport.live(IDS.ramesh);
    expect(live.currentMedicines.some((m) => m.productName === 'Old tablet')).toBe(false);
    expect(live.unconfirmed).toContainEqual({ productName: 'Old tablet', reason: UNCONFIRMED_REASONS.legacy });
  });

  it('Lakshmi: her own passport, none known allergies, no visit, nothing of Ramesh', async () => {
    const live = await services.passport.live(IDS.lakshmi);
    const want = expected.lakshmi.passport;
    expect(live.currentMedicines.map((m) => m.productName)).toEqual(want.currentMedicineNames);
    expect(live.unconfirmed.map((m) => m.productName)).toEqual(want.unconfirmedNames);
    expect(live.allergies).toEqual(want.allergies);
    expect(live.visit).toBe(want.visit);
    expect(live).toMatchObject({ documents: [], questions: [], flags: [], preparedOn: SAMPLE_TODAY });
    expect(JSON.stringify(live)).not.toMatch(/Ramesh|Amlodipine|Kavita/);
  });

  it('allergies "not recorded", the patient as the preparer, and an unknown age', async () => {
    ms = Date.parse('2026-11-20T12:00:00+05:30');
    const me = await services.profiles.create({ name: 'Meera Nair', relation: 'Myself', birthYear: null, caregiverName: '', caregiverRelation: '', emergencyContact: null });
    const live = await services.passport.live(me.id);
    expect(live).toMatchObject({ preparedBy: 'Meera Nair', patientAge: null, allergies: { state: 'not_recorded', items: [] }, visit: null, currentMedicines: [] });
    // Not a sample profile: today is the device's date.
    expect(live.preparedOn).toBe('2026-11-20');
    await services.health.add(me.id, { kind: 'procedure', text: 'Knee replacement, 2020', noneKnown: false, source: 'patient_reported', documentId: null });
    expect((await services.passport.live(me.id)).procedures).toEqual(['Knee replacement, 2020']);
    expect(await codeOf(services.passport.live('nope'))).toBe('not_found');
  });
});

describe('snapshots', () => {
  it('freezes the passport; the same passport again returns the same snapshot', async () => {
    const first = await services.passport.snapshot(IDS.ramesh, 'print');
    expect(first).toMatchObject({ profileId: IDS.ramesh, reason: 'print', revision: 1, passport: await services.passport.live(IDS.ramesh) });
    expect(await services.passport.snapshot(IDS.ramesh, 'share')).toEqual(first);
    expect(await services.passport.snapshots(IDS.ramesh)).toEqual([first]);
    // Opening the live screen creates nothing.
    await services.passport.live(IDS.ramesh);
    expect(await db.snapshots.count()).toBe(1);
  });

  it('revisions are numbered per profile, newest first', async () => {
    const r1 = await services.passport.snapshot(IDS.ramesh, 'manual');
    await services.routine.setStatus(M.atorvastatin10, 'stopped');
    const r2 = await services.passport.snapshot(IDS.ramesh, 'print');
    const l1 = await services.passport.snapshot(IDS.lakshmi, 'manual');
    expect([r1.revision, r2.revision, l1.revision]).toEqual([1, 2, 1]);
    expect((await services.passport.snapshots(IDS.ramesh)).map((s) => s.id)).toEqual([r2.id, r1.id]);
    expect((await services.passport.snapshots(IDS.lakshmi)).map((s) => s.id)).toEqual([l1.id]);
    expect(await services.passport.getSnapshot(r1.id)).toEqual(r1);
  });

  it('never changes after routine edits; after a document is deleted it only learns that the original is gone', async () => {
    const snapshot = await services.passport.snapshot(IDS.ramesh, 'print');
    const frozen = structuredClone(snapshot);
    await services.routine.setStatus(M.amlodipine10, 'stopped');
    await services.routine.update(M.telmisartan40, { instruction: '1 tablet, night' });
    await services.health.add(IDS.ramesh, { kind: 'allergy', text: 'Penicillin', noneKnown: false, source: 'caregiver_reported', documentId: null });
    await services.visits.addQuestion(IDS.visit, 'A new question?');
    expect(await services.passport.getSnapshot(snapshot.id)).toEqual(frozen);

    const { snapshotsMentioning } = await services.documents.remove(D.ecg);
    expect(snapshotsMentioning).toEqual([snapshot.id]);
    const after = await services.passport.getSnapshot(snapshot.id);
    const ecg = after.passport.documents.find((d) => d.documentId === D.ecg)!;
    expect(ecg.removedAt).toEqual(expect.any(String));
    expect({ ...ecg, removedAt: null }).toEqual(frozen.passport.documents.find((d) => d.documentId === D.ecg));
    expect({ ...after.passport, documents: frozen.passport.documents }).toEqual(frozen.passport);
    // The live passport no longer lists it.
    expect((await services.passport.live(IDS.ramesh)).documents.map((d) => d.title)).toEqual(['Lipid profile']);
  });

  it('refuses unknown reasons, profiles and snapshots', async () => {
    expect(await codeOf(services.passport.snapshot(IDS.ramesh, 'other' as 'manual'))).toBe('unknown');
    expect(await codeOf(services.passport.snapshot('nope', 'manual'))).toBe('not_found');
    expect(await codeOf(services.passport.snapshots('nope'))).toBe('not_found');
    expect(await codeOf(services.passport.getSnapshot('nope'))).toBe('not_found');
  });
});

describe('visits', () => {
  it('next is the first visit on or after the profile’s today', async () => {
    expect((await services.visits.next(IDS.ramesh))!.id).toBe(IDS.visit);
    expect(await services.visits.next(IDS.lakshmi)).toBeNull();
    // A visit before the sample's today is past.
    await services.visits.save({ profileId: IDS.ramesh, prescriberId: P.menon, at: '2026-11-01T10:00:00+05:30', questions: [], sharedDocumentIds: [] });
    expect((await services.visits.next(IDS.ramesh))!.id).toBe(IDS.visit);
    const sooner = await services.visits.save({ profileId: IDS.ramesh, prescriberId: P.menon, at: '2026-11-15T10:00:00+05:30', questions: [], sharedDocumentIds: [] });
    expect((await services.visits.next(IDS.ramesh))!.id).toBe(sooner.id);
    expect(await codeOf(services.visits.next('nope'))).toBe('not_found');
  });

  it('save checks the doctor, the time and the records, and tidies the questions', async () => {
    const base = { profileId: IDS.lakshmi, prescriberId: P.khan, at: '2026-12-01T11:00:00+05:30', sharedDocumentIds: [D.lakshmiThyroid, D.lipidProfile, D.lakshmiThyroid] };
    const visit = await services.visits.save({
      ...base,
      questions: [
        { id: '', text: '  Is the dose  right? ', source: 'manual', medicineId: null, documentId: null },
        { id: 'q2', text: 'is the dose right?', source: 'manual', medicineId: null, documentId: null },
        { id: 'q3', text: ' ', source: 'manual', medicineId: null, documentId: null },
      ],
    });
    expect(visit.questions.map((q) => q.text)).toEqual(['Is the dose right?']);
    expect(visit.questions[0].id).toEqual(expect.any(String));
    // Another profile's record is never attached.
    expect(visit.sharedDocumentIds).toEqual([D.lakshmiThyroid]);
    expect(await codeOf(services.visits.save({ ...base, prescriberId: P.rao, questions: [] }))).toBe('not_found');
    expect(await codeOf(services.visits.save({ ...base, at: 'soon', questions: [] }))).toBe('unknown');
    expect(await codeOf(services.visits.save({ ...base, id: IDS.visit, questions: [] }))).toBe('not_found');
    expect(await codeOf(services.visits.save({ ...base, profileId: 'nope', questions: [] }))).toBe('not_found');
    // Saving again with its id updates it.
    const moved = await services.visits.save({ ...visit, at: '2026-12-02T11:00:00+05:30' });
    expect(moved).toMatchObject({ id: visit.id, at: '2026-12-02T11:00:00+05:30' });
  });

  it('questions: add with links, kept once, removed', async () => {
    let visit = await services.visits.addQuestion(IDS.visit, ' Should the Dolo be stopped? ', { medicineId: M.dolo650, documentId: D.ecg });
    const added = visit.questions.at(-1)!;
    expect(added).toMatchObject({ text: 'Should the Dolo be stopped?', source: 'manual', medicineId: M.dolo650, documentId: D.ecg });
    expect((await services.visits.addQuestion(IDS.visit, 'should the dolo be stopped?')).questions).toHaveLength(3);
    expect(await codeOf(services.visits.addQuestion(IDS.visit, '  '))).toBe('unknown');
    expect(await codeOf(services.visits.addQuestion(IDS.visit, 'x', { medicineId: M.levothyroxine50 }))).toBe('not_found');
    expect(await codeOf(services.visits.addQuestion(IDS.visit, 'x', { documentId: D.lakshmiThyroid }))).toBe('not_found');
    expect(await codeOf(services.visits.addQuestion('nope', 'x'))).toBe('not_found');
    visit = await services.visits.removeQuestion(IDS.visit, added.id);
    expect(visit.questions).toHaveLength(2);
    expect(await services.visits.removeQuestion(IDS.visit, added.id)).toEqual(visit);
  });

  it('shared documents: only this profile’s records', async () => {
    const { record } = await services.documents.add(IDS.ramesh, pdf('x'), { source: 'upload', title: 'Scan' });
    const visit = await services.visits.setSharedDocuments(IDS.visit, [record.id, D.ecg, record.id]);
    expect(visit.sharedDocumentIds).toEqual([record.id, D.ecg]);
    expect(await codeOf(services.visits.setSharedDocuments(IDS.visit, [D.lakshmiThyroid]))).toBe('not_found');
    expect((await services.passport.live(IDS.ramesh)).documents.map((d) => d.title)).toEqual(['Scan', 'ECG report']);
  });
});
