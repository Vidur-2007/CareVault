import { describe, expect, it } from 'vitest';
import { expected, IDS, SAMPLE_TODAY } from '../../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../../contract/services';
import type * as T from '../../../contract/types';
import { ServiceError } from '../../../contract/types';
import { placeholderPdf } from '../placeholderPdf';
import { createMockServicesV2 } from './createMockServicesV2';
import { deviceToday } from './text';

const make = (opts: { seeded?: boolean } = {}) => createMockServicesV2({ delayMs: 0, fail: () => null, ...opts });
const M = IDS.medicines;
const D = IDS.documents;
const demo = expected.demoPrescription;

const pdfFile = (name: string, text = name) => new File([placeholderPdf([text])], name, { type: 'application/pdf' });

async function rejectsWith(promise: Promise<unknown>, code: ServiceError['code']) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

const names = (p: T.Passport) => p.currentMedicines.map((m) => m.productName);

describe('mock services v2: the sample case `expected` values', () => {
  it('seeds both sample profiles, idempotently', async () => {
    const s = make();
    expect((await s.profiles.list()).map((p) => p.id)).toEqual([IDS.ramesh, IDS.lakshmi]);
    await s.profiles.loadSampleProfile();
    expect(await s.profiles.list()).toHaveLength(2);
    const empty = make({ seeded: false });
    expect(await empty.profiles.list()).toEqual([]);
    expect((await empty.profiles.loadSampleProfile()).id).toBe(IDS.ramesh);
    expect(await empty.profiles.list()).toHaveLength(2);
  });

  it('Ramesh: routine statuses, documents newest first, totals and attention', async () => {
    const s = make();
    const routine = await s.routine.list(IDS.ramesh);
    expect(Object.fromEntries(routine.map((m) => [m.id, m.status]))).toEqual(expected.ramesh.routineStatusById);
    expect((await s.documents.list(IDS.ramesh)).map((d) => d.id)).toEqual(expected.ramesh.documentIdsNewestFirst);
    expect(await s.routine.ingredientTotals(IDS.ramesh)).toEqual(expected.ramesh.ingredientTotals);
    const attention = await s.attention.list(IDS.ramesh);
    expect(attention.map((a) => a.kind)).toEqual(expected.ramesh.attentionKinds);
    expect(attention[0].body).toBe('These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.');
    expect(attention[0].medicineIds).toEqual([M.dolo650, M.crocinAdvance500]);
  });

  it('Ramesh: the live passport', async () => {
    const s = make();
    const p = await s.passport.live(IDS.ramesh);
    const e = expected.ramesh.passport;
    expect(p.preparedOn).toBe(e.preparedOn);
    expect(p.patientAge).toBe(e.patientAge);
    expect(p.preparedBy).toBe(e.preparedBy);
    expect(p.visit).toEqual(e.visit);
    expect(names(p)).toEqual(e.currentMedicineNames);
    expect(p.unconfirmed.map((u) => u.productName)).toEqual(e.unconfirmedNames);
    expect(p.allergies).toEqual(e.allergies);
    expect(p.conditions).toEqual(e.conditions);
    expect(p.questions).toEqual(e.questions);
    expect(p.documents.map((d) => d.title)).toEqual(e.documentTitles);
    expect(p.flags).toHaveLength(1);
    expect(p.flags[0]).toContain('Please verify them with a pharmacist or prescriber.');
    // Recent changes: the last 90 days by the date the user recorded them.
    expect(p.recentChanges.map((c) => c.text)).toContain('Started Rosuvastatin 10 mg');
    expect(p.recentChanges.every((c) => c.on >= '2026-08-16')).toBe(true);
  });

  it('Ramesh: searches', async () => {
    const s = make();
    const q = expected.ramesh.search;
    const lipid = await s.records.search(IDS.ramesh, q.latestLipidProfile.query);
    expect(lipid.map((h) => h.document.id)).toEqual([q.latestLipidProfile.firstId]);
    expect(lipid[0].matchedOn).toEqual(expect.arrayContaining(['title', 'test name']));
    expect((await s.records.search(IDS.ramesh, q.hba1cByTest.query)).map((h) => h.document.id)).toEqual(q.hba1cByTest.ids);
    const rxQuery = q.cardiologyPrescriptions.query;
    const rx = await s.records.search(IDS.ramesh, { ...rxQuery, kinds: [...rxQuery.kinds] });
    expect(rx.map((h) => h.document.id)).toEqual(q.cardiologyPrescriptions.ids);
    expect(rx[0].matchedOn).toEqual(['kind', 'doctor']);
    // Text also matches the prescriber's specialty; undated records come after dated ones.
    expect((await s.records.search(IDS.ramesh, { text: 'cardiology' })).map((h) => h.document.id)).toEqual([D.raoLatest, D.ecg, D.raoPrevious]);
    expect((await s.records.search(IDS.ramesh, { text: 'lakeside', sort: 'oldest' })).map((h) => h.document.id))
      .toEqual([D.ecg, D.lipidProfile, D.hba1c]);
  });

  it('Ramesh: ask', async () => {
    const s = make();
    for (const a of expected.ramesh.ask) {
      const answer = await s.records.ask(IDS.ramesh, a.question);
      expect(answer.understood).toBe(true);
      expect(answer.kind).toBe(a.kind);
      if (a.firstDocumentId) expect(answer.documents[0].document.id).toBe(a.firstDocumentId);
      else expect(answer.questions.map((x) => x.text)).toEqual(expected.ramesh.passport.questions);
    }
    const latest = await s.records.ask(IDS.ramesh, 'latest lipid profile');
    expect(latest.text).toBe('Latest report with Lipid profile: 12 Nov 2026, Lakeside Diagnostics.');
    expect(latest.query).toEqual({ sort: 'newest', testName: 'Lipid profile', limit: 1 });
    const first = await s.records.ask(IDS.ramesh, 'first prescription from Dr. Menon');
    expect(first.documents.map((h) => h.document.id)).toEqual([D.menon]);
    expect(first.text).toContain('earliest in CareVault');
    expect((await s.records.ask(IDS.ramesh, 'reports from September 2026')).documents.map((h) => h.document.id)).toEqual([D.ecg]);
    expect((await s.records.ask(IDS.ramesh, 'last 2 prescriptions')).documents).toHaveLength(2);
    expect((await s.records.ask(IDS.ramesh, 'what medicines is he on')).medicines).toHaveLength(6);
    const unknown = await s.records.ask(IDS.ramesh, 'is my blood pressure fine');
    expect(unknown).toMatchObject({ understood: false, kind: 'not_understood', query: null });
  });

  it('Lakshmi: her own passport, totals, attention and documents only', async () => {
    const s = make();
    const p = await s.passport.live(IDS.lakshmi);
    const e = expected.lakshmi.passport;
    expect(names(p)).toEqual(e.currentMedicineNames);
    expect(p.unconfirmed.map((u) => u.productName)).toEqual(e.unconfirmedNames);
    expect(p.allergies).toEqual(e.allergies);
    expect(p.visit).toBe(e.visit);
    expect(p.preparedOn).toBe(SAMPLE_TODAY);
    expect(await s.routine.ingredientTotals(IDS.lakshmi)).toEqual(expected.lakshmi.ingredientTotals);
    expect((await s.attention.list(IDS.lakshmi)).map((a) => a.kind)).toEqual(expected.lakshmi.attentionKinds);
    expect((await s.documents.list(IDS.lakshmi)).map((d) => d.id)).toEqual(expected.lakshmi.documentIdsNewestFirst);
    expect(await s.records.search(IDS.lakshmi, { text: 'lipid' })).toEqual([]);
    expect((await s.records.ask(IDS.lakshmi, 'what questions did I save')).questions).toEqual([]);
    expect((await s.records.search(IDS.ramesh, { text: 'thyroid' }))).toEqual([]);
  });
});

/** Uploads and reads the demo prescription, then confirms every field except the Aspirin strength. */
async function demoUpload(s: CareVaultServices) {
  const { record } = await s.documents.add(IDS.ramesh, pdfFile(demo.file), { source: 'upload' });
  const candidate = await s.reading.read(record.id, { allowCloud: false });
  const aspirinStrength = candidate.fields.find((f) => f.lineIndex === 3 && f.field === 'strength')!;
  await s.documents.reviewFields(record.id, candidate.fields
    .filter((f) => f.id !== aspirinStrength.id)
    .map((f) => ({ evidenceId: f.id, action: 'confirm' as const })));
  return { record, candidate, aspirinStrength };
}

const rowFor = (p: T.RoutineProposal, d: { lineProductName?: string; medicineId?: string }) =>
  p.rows.find((r) => (d.lineProductName ? r.line?.productName === d.lineProductName : r.kind === 'not_mentioned' && r.medicine?.id === d.medicineId))!;

describe('mock services v2: the demo prescription', () => {
  it('reads "7? mg" as needing verification and keeps the original first', async () => {
    const s = make();
    const { record, candidate, aspirinStrength } = await demoUpload(s);
    expect(record.state).toBe('pending_review');
    expect(candidate.clinicalDate).toBe(demo.clinicalDate);
    expect(candidate.prescriberName).toBe('Dr. Kavita Rao');
    expect(candidate.patientMatch).toBe('match');
    expect(aspirinStrength).toMatchObject({ raw: demo.aspirinStrengthAsRead, value: null, status: 'needs_verification', reasons: ['Unclear digit'] });
    expect((await s.documents.file(record.id)).blob.size).toBeGreaterThan(0);
    // The flagged field is an attention item until it is checked.
    expect((await s.attention.list(IDS.ramesh)).map((a) => a.kind)).toContain('unverified_fields');
    // Re-reading keeps every human decision.
    const again = await s.reading.read(record.id, { allowCloud: false });
    expect(again.fields.filter((f) => f.status === 'user_confirmed')).toHaveLength(candidate.fields.length - 1);
  });

  it('proposes the expected rows, gates Aspirin, and applies the expected decisions', async () => {
    const s = make();
    const { record, candidate, aspirinStrength } = await demoUpload(s);
    const revisionBefore = await s.routine.revision(IDS.ramesh);
    const { lines, proposal } = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    expect(lines.map((l) => l.verified)).toEqual([true, true, true, false]);
    expect(await s.routine.revision(IDS.ramesh)).toBe(revisionBefore); // saving never changes the routine
    expect(proposal).not.toBeNull();
    const p = proposal!;

    // Before the strength is checked: kinds, entries, asked and blocked as expected.
    expect(p.rows.map((r) => ({ kind: r.kind, medicineId: r.medicine?.id ?? null, asked: r.asked, blockedByVerification: r.blockedByVerification })))
      .toEqual(demo.proposalRows.map((r) => ({ kind: r.kind, medicineId: r.medicineId, asked: r.asked, blockedByVerification: r.blockedByVerification })));
    expect(p.rows.map((r) => r.line?.productName ?? null)).toEqual(['Telmisartan 80 mg', 'Aspirin 7? mg', null, 'Amlodipine 10 mg', 'Rosuvastatin 10 mg']);
    expect(p.passiveNotMentionedCount).toBe(demo.passiveNotMentionedCount);
    expect(p.rows.some((r) => demo.passiveMedicineIds.includes(r.medicine?.id as never))).toBe(false);
    expect(p.rows[0].note).toBe('40 mg to 80 mg');
    expect(p.rows[0].choices).toEqual(['started_new', 'kept_previous', 'not_taking', 'ask_doctor', 'skip']);
    expect(p.rows[3].choices).toEqual([]);

    // The gate: starting Aspirin before its strength is checked is refused.
    await rejectsWith(s.routine.decide(p.id, [{ rowId: p.rows[1].id, choice: 'started' }], p.routineRevision), 'verification_required');

    // Correct the strength to 75 mg: the line, its name and the row follow.
    await s.documents.reviewFields(record.id, [{ evidenceId: aspirinStrength.id, action: 'correct', value: '75' }]);
    const strip = (l: T.PrescriptionLine) => ({ lineIndex: l.lineIndex, productName: l.productName, ingredients: l.ingredients, form: l.form, dosesPerDay: l.dosesPerDay, instruction: l.instruction, warnings: [] });
    const saved = await s.prescriptions.lines(record.id);
    expect(saved.map(strip)).toEqual(demo.verifiedLines);
    expect(saved.every((l) => l.verified)).toBe(true);
    const ready = (await s.routine.proposalFor(record.id))!;
    expect(ready.id).toBe(p.id);
    expect(ready.rows.map((r) => ({ kind: r.kind, lineProductName: r.line?.productName ?? null, medicineId: r.medicine?.id ?? null, asked: r.asked })))
      .toEqual(demo.proposalRows.map((r) => ({ kind: r.kind, lineProductName: r.lineProductName, medicineId: r.medicineId, asked: r.asked })));
    expect(ready.rows.every((r) => !r.blockedByVerification)).toBe(true);

    const before = Object.fromEntries((await s.routine.list(IDS.ramesh)).map((m) => [m.id, m]));
    const decisions = demo.decisions.map((d) => ({ rowId: rowFor(ready, d).id, choice: d.choice }));
    const result = await s.routine.decide(ready.id, decisions, ready.routineRevision);
    expect(result.questionsAdded).toEqual([]);
    expect(result.proposal.status).toBe('reviewed');

    const after = demo.afterDecisions;
    expect(names(await s.passport.live(IDS.ramesh))).toEqual(after.currentMedicineNames);
    const routine = await s.routine.list(IDS.ramesh);
    for (const stopped of after.newlyStopped) {
      const old = routine.find((m) => m.id === stopped.medicineId)!;
      expect(old.status).toBe('stopped');
      expect(routine.find((m) => m.id === old.replacedByMedicineId)?.productName).toBe(stopped.replacedByProductName);
    }
    for (const id of after.unchangedIds) expect(routine.find((m) => m.id === id)).toEqual(before[id]);
    expect(routine.find((m) => m.id === M.atorvastatin10)?.status).toBe(after.atorvastatinStatus);
    const aspirin = routine.find((m) => m.productName === 'Aspirin 75 mg')!;
    expect(aspirin).toMatchObject({ status: 'taking', source: 'from_prescription', prescriberId: demo.prescriberId, sourceDocumentId: record.id });
    expect((await s.routine.history(aspirin.id)).map((e) => e.type)).toEqual(['added']);

    // Idempotent: the same decisions again change nothing and write no event.
    const revision = await s.routine.revision(IDS.ramesh);
    const events = (await s.routine.profileHistory(IDS.ramesh)).length;
    await s.routine.decide(ready.id, decisions, revision);
    expect(await s.routine.revision(IDS.ramesh)).toBe(revision);
    expect(await s.routine.profileHistory(IDS.ramesh)).toHaveLength(events);
    // Saving the same lines twice returns the same proposal and writes nothing.
    const twice = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    expect(twice.proposal?.id).toBe(p.id);
    expect(await s.routine.profileHistory(IDS.ramesh)).toHaveLength(events);

    // Stale: an earlier revision is refused.
    await rejectsWith(s.routine.decide(ready.id, decisions, ready.routineRevision), 'stale');
  });

  it('ask_doctor adds a question to the next visit and makes the entry unconfirmed; dismiss and reopen', async () => {
    const s = make();
    const { record, candidate } = await demoUpload(s);
    const { proposal } = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    const p = proposal!;
    const { questionsAdded, changed } = await s.routine.decide(p.id, [{ rowId: p.rows[0].id, choice: 'ask_doctor' }], p.routineRevision);
    expect(questionsAdded).toHaveLength(1);
    expect(questionsAdded[0]).toMatchObject({ source: 'review', medicineId: M.telmisartan40, documentId: record.id });
    expect(questionsAdded[0].text).toContain('Telmisartan 80 mg');
    expect(changed.map((m) => [m.id, m.status])).toEqual([[M.telmisartan40, 'uncertain']]);
    expect((await s.visits.next(IDS.ramesh))?.questions).toHaveLength(3);
    expect((await s.routine.dismiss(p.id)).status).toBe('dismissed');
    const reopened = await s.routine.proposalFor(record.id);
    expect(reopened?.status).toBe('open');
    expect(reopened?.rows.find((r) => r.id === p.rows[0].id)?.decision).toBe('ask_doctor');
  });

  it('as in the core: undoing a change made by a review reopens its row', async () => {
    const s = make();
    const { record, candidate } = await demoUpload(s);
    const p = (await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines)).proposal!;
    const telmisartan = p.rows[0];
    await s.routine.decide(p.id, [{ rowId: telmisartan.id, choice: 'started_new' }], p.routineRevision);
    const events = (await s.routine.profileHistory(IDS.ramesh)).filter((e) => e.proposalId === p.id);
    expect(events.map((e) => e.type)).toEqual(['replaced', 'changed']);
    for (const e of [...events].reverse()) await s.routine.undo(e.id);
    const reopened = (await s.routine.proposalFor(record.id))!;
    expect(reopened.status).toBe('open');
    expect(reopened.rows.find((r) => r.id === telmisartan.id)).toMatchObject({ kind: 'changed', decision: null });
    expect((await s.routine.get(M.telmisartan40)).status).toBe('taking');
  });

  it('as in the core: proposalFor compares a prescription that has lines but no stored review', async () => {
    const s = make();
    const p = (await s.routine.proposalFor(D.raoLatest))!;
    // The latest Rao prescription matches the routine except Atorvastatin, which is not on it.
    expect(p.rows.filter((r) => r.asked).map((r) => [r.kind, r.medicine?.id])).toEqual([['not_mentioned', M.atorvastatin10]]);
    expect((await s.routine.proposalFor(D.raoLatest))?.id).toBe(p.id);
  });

  it('returns no proposal when nothing differs', async () => {
    const s = make();
    const { record } = await s.documents.add(IDS.ramesh, pdfFile('same.pdf'), { source: 'upload' });
    const line = (lineIndex: number, productName: string, name: string, strength: number, instruction: string): T.ExtractedLine =>
      ({ lineIndex, productName, ingredients: [{ name, strength, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction, warnings: [] });
    const result = await s.prescriptions.save(record.id, IDS.prescribers.rao, [
      line(0, 'Amlodipine 10 mg', 'amlodipine', 10, '1 tablet, morning'),
      line(1, 'Telmisartan 40 mg', 'telmisartan', 40, '1 tablet, morning'),
      line(2, 'Rosuvastatin 10 mg', 'rosuvastatin', 10, '1 tablet, night'),
      line(3, 'Atorvastatin 10 mg', 'atorvastatin', 10, '1 tablet, night'),
    ]);
    expect(result.proposal).toBeNull();
    expect(await s.routine.proposalFor(record.id)).toBeNull();
  });

  it('uncertain_match: same_medicine and different_medicine offer the row again', async () => {
    const start = async () => {
      const s = make();
      const { record } = await s.documents.add(IDS.ramesh, pdfFile('brand.pdf'), { source: 'upload' });
      const { proposal } = await s.prescriptions.save(record.id, IDS.prescribers.menon, [
        { lineIndex: 0, productName: 'Metformin SR', ingredients: [], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', warnings: [] },
      ]);
      return { s, p: proposal!, row: proposal!.rows[0] };
    };
    const a = await start();
    expect(a.row).toMatchObject({ kind: 'uncertain_match', asked: true, decision: null });
    expect(a.row.medicine?.id).toBe(M.metformin500);
    expect(a.row.choices).toEqual(['same_medicine', 'different_medicine', 'ask_doctor', 'skip']);
    const same = await a.s.routine.decide(a.p.id, [{ rowId: a.row.id, choice: 'same_medicine' }], a.p.routineRevision);
    expect(same.proposal.rows[0]).toMatchObject({ kind: 'changed', decision: null, medicine: { id: M.metformin500 } });
    expect(same.changed).toEqual([]);

    const b = await start();
    const different = await b.s.routine.decide(b.p.id, [{ rowId: b.row.id, choice: 'different_medicine' }], b.p.routineRevision);
    expect(different.proposal.rows[0]).toMatchObject({ kind: 'new', decision: null, medicine: null });
    expect(different.changed).toEqual([]);
  });
});

describe('mock services v2: routine, undo and the pack gate', () => {
  it('setStatus records events and does nothing for the same status; undo restores and refuses after a later change', async () => {
    const s = make();
    const r0 = await s.routine.revision(IDS.ramesh);
    await s.routine.setStatus(M.metformin500, 'taking');
    expect(await s.routine.revision(IDS.ramesh)).toBe(r0);
    const stopped = await s.routine.setStatus(M.metformin500, 'stopped');
    expect(stopped.status).toBe('stopped');
    const history = await s.routine.history(M.metformin500);
    const stopEvent = history.at(-1)!;
    expect(stopEvent).toMatchObject({ type: 'stopped', before: { status: 'taking' }, after: { status: 'stopped' } });
    expect((await s.routine.undo(stopEvent.id)).status).toBe('taking');
    expect((await s.routine.history(M.metformin500)).at(-1)).toMatchObject({ type: 'undone', undoesEventId: stopEvent.id });
    await rejectsWith(s.routine.undo(stopEvent.id), 'stale');

    const first = await s.routine.setStatus(M.dolo650, 'stopped');
    expect(first.status).toBe('stopped');
    const firstEvent = (await s.routine.history(M.dolo650)).at(-1)!;
    await s.routine.setStatus(M.dolo650, 'taking');
    await rejectsWith(s.routine.undo(firstEvent.id), 'stale');
    expect((await s.routine.history(M.dolo650)).at(-1)?.type).toBe('restarted');
  });

  it('routine.add from a pack photo is behind the verification gate', async () => {
    const s = make();
    const photo = new File([new Uint8Array([1, 2, 3])], 'pack.jpg', { type: 'image/jpeg' });
    const { record } = await s.documents.add(IDS.lakshmi, photo, { source: 'camera' });
    const candidate = await s.reading.read(record.id, { allowCloud: false });
    expect(candidate.engine).toBe('on_device');
    expect(candidate.lines[0]).toMatchObject({ productName: 'Dolo 650', dosesPerDay: null });
    expect(candidate.fields.filter((f) => f.status === 'needs_verification').map((f) => f.field)).toEqual(['strength', 'unit']);
    const input = { ...candidate.lines[0], dosesPerDay: 2, instruction: '1 tablet, twice a day' };
    const opts = { status: 'taking' as const, source: 'from_pack' as const, documentId: record.id };
    await rejectsWith(s.routine.add(IDS.lakshmi, input, opts), 'verification_required');
    await s.documents.reviewFields(record.id, candidate.fields.map((f) => ({ evidenceId: f.id, action: 'confirm' as const })));
    const added = await s.routine.add(IDS.lakshmi, input, opts);
    expect(added).toMatchObject({ productName: 'Dolo 650', source: 'from_pack', status: 'taking', dosesPerDay: 2, sourceDocumentId: record.id });
    // Typed by the user, no document: no gate.
    const typed = await s.routine.add(IDS.lakshmi, { ...input, productName: 'Calcium 500 mg', ingredients: [{ name: 'calcium', strength: 500, unit: 'mg' }] },
      { status: 'taking', source: 'caregiver_reported', documentId: null });
    expect(typed.source).toBe('caregiver_reported');
    expect(await s.routine.ingredientTotals(IDS.lakshmi)).toEqual([]);
  });

  it('allergies: a real allergy replaces "No known allergies"', async () => {
    const s = make();
    await s.health.add(IDS.lakshmi, { kind: 'allergy', text: 'Penicillin: rash', noneKnown: false, source: 'caregiver_reported', documentId: null });
    expect((await s.passport.live(IDS.lakshmi)).allergies).toEqual({ state: 'listed', items: ['Penicillin: rash'] });
  });
});

describe('mock services v2: documents, snapshots and sharing', () => {
  it('exact duplicates count within the same profile only', async () => {
    const s = make();
    const first = await s.documents.add(IDS.ramesh, pdfFile('scan.pdf', 'same bytes'), { source: 'upload' });
    expect(first.duplicate).toBeNull();
    expect(first.record).toMatchObject({ state: 'pending_review', clinicalDate: null, dateSource: 'unknown', title: 'scan' });
    expect(first.record.sha256).toMatch(/^[0-9a-f]{64}$/);
    const second = await s.documents.add(IDS.ramesh, pdfFile('again.pdf', 'same bytes'), { source: 'camera' });
    expect(second.duplicate).toMatchObject({ existingId: first.record.id, exact: true });
    expect((await s.documents.add(IDS.lakshmi, pdfFile('scan.pdf', 'same bytes'), { source: 'upload' })).duplicate).toBeNull();
  });

  it('a date typed by the user sets dateSource user and settles the date evidence', async () => {
    const s = make();
    const { record } = await s.documents.add(IDS.ramesh, pdfFile('lipid-profile-2026-11-01.pdf'), { source: 'upload' });
    const read = await s.reading.read(record.id, { allowCloud: false });
    expect(read).toMatchObject({ kind: 'lab_report', testNames: ['Lipid profile'], clinicalDate: '2026-11-01' });
    const updated = await s.documents.update(record.id, { clinicalDate: '2026-11-02' });
    expect(updated.dateSource).toBe('user');
    expect((await s.documents.fields(record.id)).find((f) => f.field === 'document_date')).toMatchObject({ status: 'user_corrected', value: '2026-11-02' });
  });

  it('reads pages and patient mismatches', async () => {
    const s = make();
    const { record } = await s.documents.add(IDS.ramesh, pdfFile('scan-5-pages.pdf'), { source: 'upload' });
    expect(await s.reading.read(record.id, { allowCloud: false })).toMatchObject({ pageCount: 5, pagesRead: 2, engine: 'on_device' });
    const other = await s.documents.add(IDS.ramesh, pdfFile('ecg-mismatch-2026-11-01.pdf'), { source: 'upload' });
    expect(await s.reading.read(other.record.id, { allowCloud: false })).toMatchObject({ patientNameRead: 'Sunita Rao', patientMatch: 'mismatch' });
    // Seeded documents read back their stored lines with no evidence.
    const seeded = await s.reading.read(D.raoLatest, { allowCloud: false });
    expect(seeded.lines.map((l) => l.productName)).toEqual(['Amlodipine 10 mg', 'Telmisartan 40 mg', 'Rosuvastatin 10 mg']);
    expect(seeded.fields).toEqual([]);
  });

  it('snapshots are frozen and reused; shares are bound to a snapshot and to its profile', async () => {
    const s = make();
    const a = await s.passport.snapshot(IDS.ramesh, 'share');
    expect(a.revision).toBe(1);
    expect((await s.passport.snapshot(IDS.ramesh, 'print')).id).toBe(a.id);
    const link = await s.sharing.create(a.id, 72);
    expect(link).toMatchObject({ profileId: IDS.ramesh, snapshotId: a.id, revoked: false });
    const key = link.url.split('#')[1];
    expect((await s.sharing.open(link.id, key)).id).toBe(a.id);
    await rejectsWith(s.sharing.open(link.id, 'wrong'), 'not_found');
    await rejectsWith(s.sharing.create(a.id, 24 * 8), 'unknown');
    expect((await s.sharing.list(IDS.ramesh)).map((l) => l.id)).toEqual([link.id]);
    expect(await s.sharing.list(IDS.lakshmi)).toEqual([]);
    expect((await s.sharing.listUnowned()).map((l) => [l.profileId, l.snapshotId])).toEqual([[null, null]]);

    // A change makes a new revision; the old one stays as it was.
    await s.routine.setStatus(M.dolo650, 'stopped');
    const b = await s.passport.snapshot(IDS.ramesh, 'manual');
    expect(b.revision).toBe(2);
    expect(names(b.passport)).not.toContain('Dolo 650');
    expect(names((await s.passport.getSnapshot(a.id)).passport)).toContain('Dolo 650');
    expect((await s.passport.snapshots(IDS.ramesh)).map((x) => x.revision)).toEqual([2, 1]);

    // Removing a shared document marks it in the snapshots and returns their active shares.
    const removed = await s.documents.remove(D.lipidProfile);
    expect(removed.snapshotsMentioning.sort()).toEqual([a.id, b.id].sort());
    expect(removed.activeShares.map((l) => l.id)).toEqual([link.id]);
    expect((await s.passport.getSnapshot(a.id)).passport.documents.find((d) => d.documentId === D.lipidProfile)?.removedAt).not.toBeNull();
    await rejectsWith(s.documents.get(D.lipidProfile), 'not_found');

    await s.sharing.revoke(link.id);
    await rejectsWith(s.sharing.open(link.id, key), 'revoked');
  });

  it('todayFor: sample profiles stay on the sample date, others use the device date', async () => {
    const s = make();
    const created = await s.profiles.create({
      name: 'Meera Nair', relation: 'Myself', birthYear: 1990, caregiverName: '', caregiverRelation: '', emergencyContact: null,
    });
    const p = await s.passport.live(created.id);
    expect(p.preparedOn).toBe(deviceToday());
    expect(p.preparedBy).toBe('Meera Nair');
    expect(p.allergies.state).toBe('not_recorded');
    expect((await s.passport.live(IDS.ramesh)).preparedOn).toBe(SAMPLE_TODAY);
    expect(await s.visits.next(created.id)).toBeNull();
  });
});

describe('mock services v2: Gmail and backup', () => {
  it('imports attachments per profile; a mismatched one waits for a profile', async () => {
    const s = make();
    await rejectsWith(s.gmail.findCandidates(IDS.ramesh), 'not_configured');
    await s.gmail.connect();
    const candidates = await s.gmail.findCandidates(IDS.ramesh);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => !c.alreadyImported)).toBe(true);
    const kidney = candidates[0];
    const { record } = await s.gmail.importAttachment(IDS.ramesh, kidney.messageId, kidney.attachmentId);
    expect(record).toMatchObject({ source: 'email', receivedAt: kidney.receivedAt, kind: 'lab_report', patientMatch: 'match', clinicalDate: '2026-11-13' });
    expect((await s.gmail.findCandidates(IDS.ramesh))[0].alreadyImported).toBe(true);
    expect((await s.gmail.findCandidates(IDS.lakshmi))[0].alreadyImported).toBe(false);
    expect((await s.gmail.importAttachment(IDS.ramesh, kidney.messageId, kidney.attachmentId)).duplicate?.existingId).toBe(record.id);

    const xray = candidates[2];
    const imported = await s.gmail.importAttachment(IDS.ramesh, xray.messageId, xray.attachmentId);
    expect(imported.record.patientMatch).toBe('mismatch');
    expect((await s.attention.list(IDS.ramesh)).map((a) => a.kind)).toContain('unassigned_import');
    await s.documents.assignProfile(imported.record.id, IDS.lakshmi);
    expect((await s.attention.list(IDS.ramesh)).map((a) => a.kind)).not.toContain('unassigned_import');
    expect((await s.documents.list(IDS.lakshmi)).map((d) => d.id)).toContain(imported.record.id);
  });

  it('exports and imports a backup with a passphrase', async () => {
    const s = make();
    await s.routine.setStatus(M.dolo650, 'stopped');
    const { record } = await s.documents.add(IDS.ramesh, pdfFile('note.pdf'), { source: 'upload' });
    await rejectsWith(s.backup.export('short'), 'bad_passphrase');
    const blob = await s.backup.export('correct horse');

    const fresh = make({ seeded: false });
    await rejectsWith(fresh.backup.import(blob, 'wrong passphrase'), 'bad_passphrase');
    await rejectsWith(fresh.backup.import(new Blob(['not json']), 'correct horse'), 'unsupported_file');
    await fresh.backup.import(blob, 'correct horse');
    expect((await fresh.routine.get(M.dolo650)).status).toBe('stopped');
    expect((await fresh.documents.file(record.id)).blob.size).toBe((await s.documents.file(record.id)).blob.size);
    expect(await fresh.routine.revision(IDS.ramesh)).toBe(await s.routine.revision(IDS.ramesh));
  });

  it('maps a v1 mock backup as the migration does', async () => {
    const { createMockServices } = await import('../createMockServices');
    const v1 = createMockServices({ delayMs: 0, fail: () => null });
    const blob = await v1.backup.export('correct horse');
    const s = make({ seeded: false });
    await s.backup.import(blob, 'correct horse');
    const [profile] = await s.profiles.list();
    expect(profile.emergencyContact).toBeNull();
    const routine = await s.routine.list(profile.id);
    expect(routine.length).toBeGreaterThan(0);
    expect(routine.every((m) => m.legacyStatus !== null)).toBe(true);
    const history = await s.routine.profileHistory(profile.id);
    expect(history.filter((e) => e.type === 'migrated')).toHaveLength(routine.length);
    if (routine.some((m) => m.legacyReviewPending)) {
      expect((await s.attention.list(profile.id)).map((a) => a.kind)).toContain('legacy_routine_review');
    }
  });
});
