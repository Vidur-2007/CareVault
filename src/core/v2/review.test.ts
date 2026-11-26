// @vitest-environment node
// The reported routine and the contextual review (overview 9.2 to 9.4), through the services,
// on the sample case. Lines are typed here; the golden test reads the real demo PDF.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDS, sampleCase } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import type { ExtractedLine, FieldEvidence, ID, Ingredient, ProposalRow, RoutineProposal, ServiceError } from '../../contract/types';
import { createRealServicesV2 } from './createRealServicesV2';
import { CareVaultDbV2 } from './db/schema';

const M = IDS.medicines;
const P = IDS.prescribers;

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;
let tickMs: number;

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);

beforeEach(async () => {
  counter += 1;
  let ids = 0;
  // Every call to the clock is one second later, so events have a clear order.
  tickMs = Date.parse('2026-11-14T09:00:00+05:30');
  db = new CareVaultDbV2(`review-v2-test-${counter}`);
  services = createRealServicesV2({ db, now: () => new Date((tickMs += 1000)), newId: () => `id-${(ids += 1)}` });
  await services.profiles.loadSampleProfile();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const mg = (name: string, strength: number): Ingredient[] => [{ name, strength, unit: 'mg' }];

function line(lineIndex: number, productName: string, ingredients: Ingredient[], dosesPerDay: number | null = 1, instruction = '1 tablet, morning'): ExtractedLine {
  return { lineIndex, productName, ingredients, form: 'tablet', dosesPerDay, instruction, warnings: [] };
}

const AMLODIPINE = line(0, 'Amlodipine 10 mg', mg('amlodipine', 10));
const TELMISARTAN_80 = line(1, 'Telmisartan 80 mg', mg('telmisartan', 80));
const ROSUVASTATIN = line(2, 'Rosuvastatin 10 mg', mg('rosuvastatin', 10), 1, '1 tablet, night');
const ASPIRIN = line(3, 'Aspirin 75 mg', mg('aspirin', 75), 1, '1 tablet, afternoon');
const DEMO = [AMLODIPINE, TELMISARTAN_80, ROSUVASTATIN, ASPIRIN];

async function newPrescription(profileId: ID = IDS.ramesh): Promise<ID> {
  const { record } = await services.documents.add(profileId, new Blob(['%PDF-1.4 rx'], { type: 'application/pdf' }), { source: 'camera', title: 'Prescription' });
  return record.id;
}

async function review(lines: ExtractedLine[], prescriberId: ID = P.rao, documentId?: ID) {
  const id = documentId ?? (await newPrescription());
  const saved = await services.prescriptions.save(id, prescriberId, lines);
  return { documentId: id, ...saved };
}

const rowFor = (proposal: RoutineProposal, test: (r: ProposalRow) => boolean) => {
  const row = proposal.rows.find(test);
  if (!row) throw new Error('row not found');
  return row;
};
const lineRow = (p: RoutineProposal, name: string) => rowFor(p, (r) => r.line?.productName === name);
const medicineRow = (p: RoutineProposal, id: ID) => rowFor(p, (r) => r.line === null && r.medicine?.id === id);

async function decide(proposal: RoutineProposal, ...decisions: [ProposalRow, ProposalRow['choices'][number]][]) {
  return services.routine.decide(proposal.id, decisions.map(([row, choice]) => ({ rowId: row.id, choice })), await services.routine.revision(proposal.profileId));
}

const routineOf = async (profileId: ID = IDS.ramesh) => services.routine.list(profileId);
const eventCount = async () => (await services.routine.profileHistory(IDS.ramesh)).length;

describe('saving a prescription', () => {
  it('stores the lines and never touches the routine', async () => {
    const before = await routineOf();
    const events = await eventCount();
    const { documentId, lines, proposal } = await review(DEMO);
    expect(lines.map((l) => [l.lineIndex, l.productName, l.verified])).toEqual(DEMO.map((l) => [l.lineIndex, l.productName, true]));
    expect(await services.prescriptions.lines(documentId)).toEqual(lines);
    expect(proposal).not.toBeNull();
    expect(await routineOf()).toEqual(before);
    expect(await eventCount()).toBe(events);
    expect((await services.documents.get(documentId)).prescriberId).toBe(P.rao);
  });

  it('gives the rows, order and choices of section 9.3', async () => {
    const { proposal } = await review(DEMO);
    expect(proposal!.rows.map((r) => [r.kind, r.line?.productName ?? null, r.medicine?.id ?? null, r.asked, r.blockedByVerification])).toEqual(
      // Typed lines are checked lines: the state after the check.
      sampleCase.expected.demoPrescription.proposalRowsAfterCheck.map((r) => [r.kind, r.lineProductName, r.medicineId, r.asked, r.blockedByVerification]),
    );
    expect(proposal!.passiveNotMentionedCount).toBe(3);
    expect(proposal!.routineRevision).toBe(await services.routine.revision(IDS.ramesh));
    expect(proposal!.status).toBe('open');
    expect(lineRow(proposal!, 'Telmisartan 80 mg')).toMatchObject({ note: '40 mg to 80 mg', choices: ['started_new', 'kept_previous', 'not_taking', 'ask_doctor', 'skip'] });
    expect(lineRow(proposal!, 'Aspirin 75 mg')).toMatchObject({ note: 'New on this prescription', choices: ['started', 'not_started', 'not_taking', 'ask_doctor', 'skip'] });
    expect(medicineRow(proposal!, M.atorvastatin10)).toMatchObject({ note: 'Not on this prescription', choices: ['still_taking', 'not_taking', 'ask_doctor', 'skip'] });
    expect(lineRow(proposal!, 'Amlodipine 10 mg')).toMatchObject({ choices: [], note: 'No change', decision: null });
  });

  it('the same lines saved twice return the same proposal and create no events', async () => {
    const first = await review(DEMO);
    const events = await eventCount();
    const again = await services.prescriptions.save(first.documentId, P.rao, DEMO);
    expect(again).toEqual({ lines: first.lines, proposal: first.proposal });
    expect(await eventCount()).toBe(events);
    expect(await db.proposals.count()).toBe(1);
  });

  it('returns null when nothing differs, and removes an earlier review that no longer has anything to ask', async () => {
    // A doctor with no entries in the routine: nothing is "not mentioned".
    const gp = await services.profiles.addPrescriber(IDS.ramesh, { name: 'Dr. Nair', specialty: 'General medicine' });
    const { documentId, proposal } = await review([AMLODIPINE, ROSUVASTATIN], gp.id);
    expect(proposal).toBeNull();
    expect(await services.routine.proposalFor(documentId)).toBeNull();
    // A changed line gives a proposal; saving it back to the routine values removes it.
    const changed = await services.prescriptions.save(documentId, gp.id, [AMLODIPINE, TELMISARTAN_80]);
    expect(changed.proposal).not.toBeNull();
    expect((await services.prescriptions.save(documentId, gp.id, [AMLODIPINE])).proposal).toBeNull();
    expect(await db.proposals.count()).toBe(0);
  });

  it('asks about missing medicines only for the same prescriber; every other entry is passive', async () => {
    const menon = await review([line(0, 'Metformin 1000 mg', mg('metformin', 1000), 2, '1 tablet, twice a day')], P.menon);
    expect(menon.proposal!.rows.map((r) => r.kind)).toEqual(['changed']);
    expect(menon.proposal!.passiveNotMentionedCount).toBe(6);

    const rao = await review([AMLODIPINE], P.rao);
    expect(rao.proposal!.rows.filter((r) => r.kind === 'not_mentioned').map((r) => r.medicine!.productName)).toEqual([
      'Atorvastatin 10 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg',
    ]);
    expect(rao.proposal!.passiveNotMentionedCount).toBe(3);
    // Stopped entries are never compared.
    expect(rao.proposal!.rows.some((r) => r.medicine?.id === M.amlodipine5 || r.medicine?.id === M.pantoprazole40)).toBe(false);
  });

  it('validates its input', async () => {
    const documentId = await newPrescription();
    expect(await codeOf(services.prescriptions.save(documentId, P.khan, DEMO))).toBe('not_found');
    expect(await codeOf(services.prescriptions.save('missing', P.rao, DEMO))).toBe('not_found');
    expect(await codeOf(services.prescriptions.save(documentId, P.rao, [AMLODIPINE, { ...ASPIRIN, lineIndex: 0 }]))).toBe('unknown');
    expect(await codeOf(services.prescriptions.save(documentId, P.rao, [{ ...AMLODIPINE, productName: ' ' }]))).toBe('unknown');
    expect(await codeOf(services.prescriptions.lines('missing'))).toBe('not_found');
  });
});

describe('deciding', () => {
  it('started adds the line as taken, from the prescription', async () => {
    const { proposal } = await review(DEMO);
    const result = await decide(proposal!, [lineRow(proposal!, 'Aspirin 75 mg'), 'started']);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      productName: 'Aspirin 75 mg', status: 'taking', source: 'from_prescription', prescriberId: P.rao,
      sourceDocumentId: proposal!.documentId, ingredients: mg('aspirin', 75), lastConfirmedAt: expect.any(String),
    });
    expect(lineRow(result.proposal, 'Aspirin 75 mg')).toMatchObject({ decision: 'started', decidedAt: expect.any(String) });
    expect(result.proposal.routineRevision).toBe(await services.routine.revision(IDS.ramesh));
    const [event] = await services.routine.history(result.changed[0].id);
    expect(event).toMatchObject({ type: 'added', before: null, after: result.changed[0], proposalId: proposal!.id, documentId: proposal!.documentId });
  });

  it('not_started keeps the line for reference, never as current; not_taking on a new line adds nothing', async () => {
    const { proposal } = await review(DEMO);
    const result = await decide(proposal!, [lineRow(proposal!, 'Aspirin 75 mg'), 'not_started']);
    expect(result.changed[0]).toMatchObject({ status: 'not_started', lastConfirmedAt: null });

    const other = await review([line(0, 'Clopidogrel 75 mg', mg('clopidogrel', 75))]);
    const events = await eventCount();
    const notTaking = await decide(other.proposal!, [lineRow(other.proposal!, 'Clopidogrel 75 mg'), 'not_taking']);
    expect(notTaking.changed).toEqual([]);
    expect(lineRow(notTaking.proposal, 'Clopidogrel 75 mg').decision).toBe('not_taking');
    expect(await eventCount()).toBe(events);
  });

  it('started_new stops the old entry, replaced by the new one', async () => {
    const { proposal } = await review(DEMO);
    const { changed } = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new']);
    const [old, created] = changed;
    expect(old).toMatchObject({ id: M.telmisartan40, status: 'stopped', replacedByMedicineId: created.id });
    expect(created).toMatchObject({ productName: 'Telmisartan 80 mg', status: 'taking', source: 'from_prescription' });
    expect((await services.routine.history(M.telmisartan40))[0]).toMatchObject({ type: 'replaced', before: { status: 'taking' }, after: { status: 'stopped' } });
  });

  it('kept_previous and still_taking only refresh when the entry was last confirmed', async () => {
    const { proposal } = await review(DEMO);
    const before = await services.routine.get(M.telmisartan40);
    const { changed } = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'kept_previous'], [medicineRow(proposal!, M.atorvastatin10), 'still_taking']);
    expect(changed.map((m) => m.id)).toEqual([M.telmisartan40, M.atorvastatin10]);
    expect(changed[0]).toEqual({ ...before, lastConfirmedAt: changed[0].lastConfirmedAt, updatedAt: changed[0].updatedAt });
    expect(Date.parse(changed[0].lastConfirmedAt!)).toBeGreaterThan(Date.parse(before.lastConfirmedAt!));
    // Atorvastatin was not confirmed; saying it is still taken confirms it.
    expect(changed[1]).toMatchObject({ status: 'taking', lastConfirmedAt: expect.any(String) });
  });

  it('not_taking stops a changed or missing entry', async () => {
    const { proposal } = await review(DEMO);
    const { changed } = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'not_taking'], [medicineRow(proposal!, M.atorvastatin10), 'not_taking']);
    expect(changed.map((m) => [m.id, m.status])).toEqual([[M.telmisartan40, 'stopped'], [M.atorvastatin10, 'stopped']]);
  });

  it('ask_doctor adds a question to the next visit; changed and missing entries become not confirmed', async () => {
    const { proposal } = await review(DEMO);
    const result = await decide(
      proposal!,
      [lineRow(proposal!, 'Telmisartan 80 mg'), 'ask_doctor'],
      [medicineRow(proposal!, M.atorvastatin10), 'ask_doctor'],
      [lineRow(proposal!, 'Aspirin 75 mg'), 'ask_doctor'],
    );
    // Atorvastatin was already not confirmed: no event for it.
    expect(result.changed.map((m) => [m.id, m.status])).toEqual([[M.telmisartan40, 'uncertain']]);
    expect(result.questionsAdded.map((q) => q.text)).toEqual([
      'Telmisartan 40 mg or Telmisartan 80 mg (40 mg to 80 mg): which should be taken?',
      'Atorvastatin 10 mg was not on the prescription. Should it still be taken?',
      'Should Aspirin 75 mg be started?',
    ]);
    expect(result.questionsAdded[0]).toMatchObject({ source: 'review', medicineId: M.telmisartan40, documentId: proposal!.documentId });
    expect(result.questionsAdded[2].medicineId).toBeNull();
    const visit = await db.visits.get(IDS.visit);
    expect(visit!.questions.slice(-3)).toEqual(result.questionsAdded);
    // Every asked row has an answer.
    expect(result.proposal.status).toBe('reviewed');
  });

  it('ask_doctor without a next visit changes the entry and adds no question', async () => {
    await db.visits.clear();
    const { proposal } = await review(DEMO);
    const result = await decide(proposal!, [medicineRow(proposal!, M.atorvastatin10), 'ask_doctor']);
    expect(result.questionsAdded).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('is idempotent: the same decision again changes nothing and writes no event', async () => {
    const { proposal } = await review(DEMO);
    const first = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new']);
    const events = await eventCount();
    const again = await decide(first.proposal, [lineRow(first.proposal, 'Telmisartan 80 mg'), 'started_new']);
    expect(again.changed).toEqual([]);
    expect(again.proposal).toEqual(first.proposal);
    expect(await eventCount()).toBe(events);
  });

  it('refuses a choice that is not offered, a row of another review, and changing a decision that wrote the routine', async () => {
    const { proposal } = await review(DEMO);
    const telmisartan = lineRow(proposal!, 'Telmisartan 80 mg');
    const revision = await services.routine.revision(IDS.ramesh);
    expect(await codeOf(services.routine.decide(proposal!.id, [{ rowId: telmisartan.id, choice: 'started' }], revision))).toBe('unknown');
    expect(await codeOf(services.routine.decide(proposal!.id, [{ rowId: lineRow(proposal!, 'Amlodipine 10 mg').id, choice: 'skip' }], revision))).toBe('unknown');
    expect(await codeOf(services.routine.decide(proposal!.id, [{ rowId: 'nope', choice: 'skip' }], revision))).toBe('not_found');
    expect(await codeOf(services.routine.decide('nope', [], revision))).toBe('not_found');

    const decided = await decide(proposal!, [telmisartan, 'started_new']);
    expect(await codeOf(decide(decided.proposal, [lineRow(decided.proposal, 'Telmisartan 80 mg'), 'kept_previous']))).toBe('unknown');
  });

  it('stale: a routine change after the review was prepared is refused, and proposalFor gives the recomputed review', async () => {
    const { documentId, proposal } = await review(DEMO);
    await services.routine.setStatus(M.atorvastatin10, 'stopped');
    const events = await eventCount();
    const error = await services.routine.decide(proposal!.id, [{ rowId: lineRow(proposal!, 'Aspirin 75 mg').id, choice: 'started' }], proposal!.routineRevision).catch((e: ServiceError) => e);
    expect(error).toMatchObject({ code: 'stale', message: 'The medicine list changed since this review was prepared. It has been refreshed.' });
    expect(await eventCount()).toBe(events);

    const fresh = await services.routine.proposalFor(documentId);
    expect(fresh!.routineRevision).toBe(proposal!.routineRevision + 1);
    // Atorvastatin is no longer in the routine under review.
    expect(fresh!.rows.some((r) => r.medicine?.id === M.atorvastatin10)).toBe(false);
    expect((await services.routine.decide(fresh!.id, [{ rowId: lineRow(fresh!, 'Aspirin 75 mg').id, choice: 'started' }], fresh!.routineRevision)).changed).toHaveLength(1);
  });

  it('skip records nothing in the routine; the review is reopened with proposalFor and decided later', async () => {
    const { documentId, proposal } = await review(DEMO);
    const events = await eventCount();
    const skipped = await decide(proposal!, [lineRow(proposal!, 'Aspirin 75 mg'), 'skip'], [medicineRow(proposal!, M.atorvastatin10), 'skip']);
    expect(skipped.changed).toEqual([]);
    expect(await eventCount()).toBe(events);
    expect(skipped.proposal.status).toBe('open');

    const reopened = await services.routine.proposalFor(documentId);
    expect(lineRow(reopened!, 'Aspirin 75 mg').decision).toBe('skip');
    const later = await decide(reopened!, [lineRow(reopened!, 'Aspirin 75 mg'), 'started']);
    expect(lineRow(later.proposal, 'Aspirin 75 mg').decision).toBe('started');
  });

  it('proposalFor with nothing changed writes nothing and notifies nobody (it is called on every notification)', async () => {
    const { documentId } = await review(DEMO);
    await services.routine.proposalFor(documentId);
    await new Promise((r) => setTimeout(r, 0));
    let heard = 0;
    const stop = services.subscribe(() => (heard += 1));
    for (let i = 0; i < 3; i += 1) await services.routine.proposalFor(documentId);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(heard).toBe(0);
  });

  it('dismiss, then proposalFor reopens the review', async () => {
    const { documentId, proposal } = await review(DEMO);
    expect((await services.routine.dismiss(proposal!.id)).status).toBe('dismissed');
    expect((await services.routine.dismiss(proposal!.id)).status).toBe('dismissed');
    const reopened = await services.routine.proposalFor(documentId);
    expect(reopened).toMatchObject({ id: proposal!.id, status: 'open' });
    expect(await codeOf(services.routine.dismiss('nope'))).toBe('not_found');
  });

  it('a review that was fully answered is "reviewed", and stays reviewed when reopened', async () => {
    const { documentId, proposal } = await review(DEMO);
    const done = await decide(
      proposal!,
      [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new'],
      [lineRow(proposal!, 'Aspirin 75 mg'), 'started'],
      [medicineRow(proposal!, M.atorvastatin10), 'not_taking'],
    );
    expect(done.proposal.status).toBe('reviewed');
    const reopened = await services.routine.proposalFor(documentId);
    expect(reopened!.status).toBe('reviewed');
    // The decided rows are kept as they were decided, though the routine now matches the lines.
    expect(reopened!.rows.map((r) => [r.kind, r.decision])).toEqual(done.proposal.rows.map((r) => [r.kind, r.decision]));
  });
});

describe('uncertain matches', () => {
  const DOLO_NO_INGREDIENTS = line(0, 'Dolo', [], 3, '1 tablet, three times a day');

  it('a brand name alone never merges two medicines', async () => {
    const before = await routineOf();
    const { proposal } = await review([DOLO_NO_INGREDIENTS], P.menon);
    const row = lineRow(proposal!, 'Dolo');
    expect(row).toMatchObject({ kind: 'uncertain_match', asked: true, blockedByVerification: true, choices: ['same_medicine', 'different_medicine', 'ask_doctor', 'skip'] });
    expect(row.medicine!.id).toBe(M.dolo650);
    expect(row.note).toBe('Same name as Dolo 650, but the ingredients differ or are not known');
    expect(await routineOf()).toEqual(before);
  });

  it('a different ingredient under the same brand is uncertain, not "changed"', async () => {
    const { proposal } = await review([line(0, 'Dolo 650 Plus', [...mg('paracetamol', 650), ...mg('caffeine', 50)], 3)], P.menon);
    expect(lineRow(proposal!, 'Dolo 650 Plus')).toMatchObject({ kind: 'uncertain_match', medicine: { id: M.dolo650 } });
  });

  it('same_medicine compares the line with that entry and offers the row again; different_medicine makes it new', async () => {
    const { documentId, proposal } = await review([line(0, 'Dolo Plus', [...mg('paracetamol', 650), ...mg('caffeine', 50)], 3)], P.menon);
    const same = await decide(proposal!, [lineRow(proposal!, 'Dolo Plus'), 'same_medicine']);
    expect(same.changed).toEqual([]);
    expect(lineRow(same.proposal, 'Dolo Plus')).toMatchObject({ kind: 'changed', medicine: { id: M.dolo650 }, decision: null, asked: true });
    // Remembered when the review is opened again.
    expect(lineRow((await services.routine.proposalFor(documentId))!, 'Dolo Plus').kind).toBe('changed');

    const other = await review([line(0, 'Dolo Plus', [...mg('paracetamol', 650), ...mg('caffeine', 50)], 3)], P.menon);
    const different = await decide(other.proposal!, [lineRow(other.proposal!, 'Dolo Plus'), 'different_medicine']);
    expect(lineRow(different.proposal, 'Dolo Plus')).toMatchObject({ kind: 'new', medicine: null, decision: null });
    expect((await decide(different.proposal, [lineRow(different.proposal, 'Dolo Plus'), 'started'])).changed[0]).toMatchObject({ productName: 'Dolo Plus' });
    // Two paracetamol entries plus the new one: nothing was merged.
    expect((await routineOf()).filter((m) => m.ingredients.some((i) => i.name === 'paracetamol'))).toHaveLength(3);
  });

  it('a line with no ingredients and no name match cannot be called the same as anything', async () => {
    const { proposal } = await review([line(0, 'Xyzzy', [], 1)], P.menon);
    expect(lineRow(proposal!, 'Xyzzy')).toMatchObject({ kind: 'uncertain_match', medicine: null, choices: ['different_medicine', 'ask_doctor', 'skip'] });
    const asked = await decide(proposal!, [lineRow(proposal!, 'Xyzzy'), 'ask_doctor']);
    expect(asked.questionsAdded.map((q) => q.text)).toEqual(['Which medicine is "Xyzzy"?']);
  });

  it('asks the doctor whether a same-name medicine is the same', async () => {
    const { proposal } = await review([DOLO_NO_INGREDIENTS], P.menon);
    const asked = await decide(proposal!, [lineRow(proposal!, 'Dolo'), 'ask_doctor']);
    expect(asked.questionsAdded.map((q) => q.text)).toEqual(['Is Dolo the same medicine as Dolo 650?']);
    expect(asked.changed).toEqual([]);
  });
});

describe('the verification gate', () => {
  async function withUnclearStrength() {
    const documentId = await newPrescription();
    const evidence: FieldEvidence = {
      id: 'ev-aspirin-strength', profileId: IDS.ramesh, documentId, field: 'strength', lineIndex: 3, ingredientIndex: 0, page: 1,
      raw: '7? mg', value: null, status: 'needs_verification', reasons: ['Unclear digit'], source: 'pdf_text', confidence: null, region: null, reviewedAt: null,
    };
    const name: FieldEvidence = { ...evidence, id: 'ev-aspirin-name', field: 'medicine_name', ingredientIndex: null, raw: 'Aspirin 7? mg', value: 'Aspirin 7? mg', status: 'extracted', reasons: [] };
    await db.fieldEvidence.bulkPut([evidence, name]);
    const unclear = { ...ASPIRIN, productName: 'Aspirin 7? mg', ingredients: mg('aspirin', 0) };
    return review([AMLODIPINE, TELMISARTAN_80, ROSUVASTATIN, unclear], P.rao, documentId);
  }

  it('saving confirms the values the user saw; flagged values keep the line blocked', async () => {
    const { documentId, lines, proposal } = await withUnclearStrength();
    expect(lines[3].verified).toBe(false);
    expect(lineRow(proposal!, 'Aspirin 7? mg').blockedByVerification).toBe(true);
    const fields = await services.documents.fields(documentId);
    expect(fields.map((f) => [f.field, f.status])).toEqual([['medicine_name', 'user_confirmed'], ['strength', 'needs_verification']]);
  });

  it('started is refused until the strength is checked, then succeeds with the corrected line', async () => {
    const { documentId, proposal } = await withUnclearStrength();
    const aspirin = lineRow(proposal!, 'Aspirin 7? mg');
    expect(await codeOf(decide(proposal!, [aspirin, 'started']))).toBe('verification_required');
    // Recording a question and keeping it for reference are never blocked.
    expect(await codeOf(decide(proposal!, [aspirin, 'skip']))).toBe('resolved');

    await services.documents.reviewFields(documentId, [{ evidenceId: 'ev-aspirin-strength', action: 'correct', value: '75' }]);
    expect((await services.prescriptions.lines(documentId))[3]).toMatchObject({ productName: 'Aspirin 75 mg', ingredients: mg('aspirin', 75), verified: true });
    const fresh = await services.routine.proposalFor(documentId);
    const row = lineRow(fresh!, 'Aspirin 75 mg');
    expect(row.blockedByVerification).toBe(false);
    expect((await decide(fresh!, [row, 'started'])).changed[0]).toMatchObject({ productName: 'Aspirin 75 mg', ingredients: mg('aspirin', 75) });
  });

  it('a value left unknown keeps the line unverified; not_started is still allowed', async () => {
    const { documentId, proposal } = await withUnclearStrength();
    await services.documents.reviewFields(documentId, [{ evidenceId: 'ev-aspirin-strength', action: 'leave_unknown' }]);
    const fresh = await services.routine.proposalFor(documentId);
    const row = lineRow(fresh!, 'Aspirin 7? mg');
    expect(row.blockedByVerification).toBe(true);
    expect(await codeOf(decide(fresh!, [row, 'started']))).toBe('verification_required');
    expect((await decide(fresh!, [row, 'not_started'])).changed[0]).toMatchObject({ status: 'not_started', ingredients: mg('aspirin', 0) });
    void proposal;
  });

  it('the evidence wins (UI request v2-1): a flagged value cannot be slipped in through the lines', async () => {
    const documentId = await newPrescription();
    const strength: FieldEvidence = {
      id: 'ev-s', profileId: IDS.ramesh, documentId, field: 'strength', lineIndex: 0, ingredientIndex: 0, page: 1,
      raw: '7? mg', value: null, status: 'needs_verification', reasons: ['Unclear digit'], source: 'ocr', confidence: 0.4, region: null, reviewedAt: null,
    };
    const name: FieldEvidence = { ...strength, id: 'ev-n', field: 'medicine_name', ingredientIndex: null, raw: 'Aspirin 7? mg', value: 'Aspirin 7? mg', status: 'extracted', reasons: [] };
    await db.fieldEvidence.bulkPut([strength, name]);
    // The caller claims 75 mg, with the name it was read with.
    const { lines, proposal } = await review([{ ...ASPIRIN, lineIndex: 0, productName: 'Aspirin 7? mg' }], P.rao, documentId);
    expect(lines[0]).toMatchObject({ productName: 'Aspirin 7? mg', ingredients: mg('aspirin', 0), verified: false });
    const row = lineRow(proposal!, 'Aspirin 7? mg');
    expect(await codeOf(decide(proposal!, [row, 'started']))).toBe('verification_required');
    expect((await services.documents.fields(documentId)).find((f) => f.id === 'ev-s')).toMatchObject({ status: 'needs_verification', value: null });
  });

  it('the evidence wins: a value edited in the line form is recorded as the user’s correction', async () => {
    const documentId = await newPrescription();
    const base: FieldEvidence = {
      id: 'ev-i', profileId: IDS.ramesh, documentId, field: 'instruction', lineIndex: 0, ingredientIndex: null, page: 1,
      raw: '1-0-0', value: '1 tablet, morning', status: 'extracted', reasons: [], source: 'pdf_text', confidence: null, region: null, reviewedAt: null,
    };
    const strength: FieldEvidence = { ...base, id: 'ev-st', field: 'strength', ingredientIndex: 0, raw: '10 mg', value: '10' };
    await db.fieldEvidence.bulkPut([base, strength]);
    const { lines } = await review([{ ...AMLODIPINE, instruction: '1 tablet, night' }], P.rao, documentId);
    expect(lines[0]).toMatchObject({ instruction: '1 tablet, night', verified: true });
    const fields = await services.documents.fields(documentId);
    expect(fields.find((f) => f.id === 'ev-i')).toMatchObject({ status: 'user_corrected', value: '1 tablet, night' });
    // Unchanged values are confirmed as they were read.
    expect(fields.find((f) => f.id === 'ev-st')).toMatchObject({ status: 'user_confirmed', value: '10' });
  });

  it('routine.add from a pack photo is gated by its document', async () => {
    const { record } = await services.documents.add(IDS.ramesh, new Blob(['%PDF-1.4 pack'], { type: 'application/pdf' }), { source: 'camera' });
    const flagged: FieldEvidence = {
      id: 'ev-pack', profileId: IDS.ramesh, documentId: record.id, field: 'strength', lineIndex: 0, ingredientIndex: 0, page: 1,
      raw: '5?0 mg', value: null, status: 'needs_verification', reasons: ['Unclear digit'], source: 'ocr', confidence: 0.4, region: null, reviewedAt: null,
    };
    const named: FieldEvidence = { ...flagged, id: 'ev-pack-name', field: 'medicine_name', ingredientIndex: null, raw: 'Pan 40', value: 'Pan 40', status: 'extracted', reasons: [] };
    await db.fieldEvidence.bulkPut([flagged, named]);
    const input = { productName: 'Pan 40', ingredients: mg('pantoprazole', 40), form: 'tablet' as const, dosesPerDay: 1, instruction: '1 tablet, before breakfast' };
    const opts = { status: 'uncertain' as const, source: 'from_pack' as const, documentId: record.id };
    expect(await codeOf(services.routine.add(IDS.ramesh, input, opts))).toBe('verification_required');
    await services.documents.reviewFields(record.id, [{ evidenceId: 'ev-pack', action: 'correct', value: '40' }]);
    const added = await services.routine.add(IDS.ramesh, input, opts);
    expect(added).toMatchObject({ status: 'uncertain', source: 'from_pack', sourceDocumentId: record.id, lastConfirmedAt: null });
    expect((await services.documents.fields(record.id)).find((f) => f.id === 'ev-pack-name')!.status).toBe('user_confirmed');
    expect((await services.routine.history(added.id))[0].detail).toBe('Added from a photo of the pack');
    // Another profile's document cannot be used.
    expect(await codeOf(services.routine.add(IDS.lakshmi, input, opts))).toBe('not_found');
  });
});

describe('undo', () => {
  it('undoes a replacement as a whole and reopens its row', async () => {
    const { documentId, proposal } = await review(DEMO);
    const before = await routineOf();
    const { changed } = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new']);
    const [replaced] = await services.routine.history(M.telmisartan40);
    const restored = await services.routine.undo(replaced.id);
    expect(restored).toMatchObject({ id: M.telmisartan40, status: 'taking', replacedByMedicineId: null });
    expect(await codeOf(services.routine.get(changed[1].id))).toBe('not_found');
    const strip = (list: typeof before) => list.map((m) => ({ ...m, updatedAt: '' }));
    expect(strip(await routineOf())).toEqual(strip(before));
    expect((await services.routine.history(M.telmisartan40))[0]).toMatchObject({ type: 'undone', undoesEventId: replaced.id });

    const reopened = await services.routine.proposalFor(documentId);
    expect(lineRow(reopened!, 'Telmisartan 80 mg')).toMatchObject({ kind: 'changed', decision: null });
    expect(reopened!.status).toBe('open');
    // Undone once is enough.
    expect(await codeOf(services.routine.undo(replaced.id))).toBe('unknown');
  });

  it('undoing an addition removes the entry; undoing the other half of a replacement works too', async () => {
    const { proposal } = await review(DEMO);
    const { changed } = await decide(proposal!, [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new']);
    const [added] = await services.routine.history(changed[1].id);
    await services.routine.undo(added.id);
    expect((await services.routine.get(M.telmisartan40)).status).toBe('taking');
    expect(await codeOf(services.routine.get(changed[1].id))).toBe('not_found');
    // The removed entry's history can still be read.
    expect((await services.routine.history(changed[1].id)).map((e) => e.type)).toEqual(['undone', 'added']);
  });

  it('is refused with stale when a later change touched the entry', async () => {
    const stopped = await services.routine.setStatus(M.dolo650, 'stopped');
    void stopped;
    const [stopEvent] = await services.routine.history(M.dolo650);
    await services.routine.setStatus(M.dolo650, 'taking');
    expect(await codeOf(services.routine.undo(stopEvent.id))).toBe('stale');
    const [restart] = await services.routine.history(M.dolo650);
    expect(restart.type).toBe('restarted');
    expect((await services.routine.undo(restart.id)).status).toBe('stopped');
  });

  it('refuses unknown events and migrations', async () => {
    expect(await codeOf(services.routine.undo('nope'))).toBe('not_found');
    const migrated = (await services.routine.profileHistory(IDS.ramesh)).find((e) => e.type === 'migrated');
    if (migrated) expect(await codeOf(services.routine.undo(migrated.id))).toBe('unknown');
  });
});

describe('the routine', () => {
  it('lists taken entries first, then not confirmed, not started and stopped', async () => {
    const list = await routineOf();
    expect(list.map((m) => m.status)).toEqual(['taking', 'taking', 'taking', 'taking', 'taking', 'taking', 'uncertain', 'stopped', 'stopped']);
    expect(list.slice(0, 6).map((m) => m.productName)).toEqual(['Amlodipine 10 mg', 'Crocin Advance 500', 'Dolo 650', 'Metformin 500 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg']);
    expect((await routineOf(IDS.lakshmi)).map((m) => m.id)).toEqual([M.levothyroxine50]);
    expect(await codeOf(services.routine.list('nope'))).toBe('not_found');
    expect(await codeOf(services.routine.get('nope'))).toBe('not_found');
    expect(await codeOf(services.routine.history('nope'))).toBe('not_found');
    expect(await codeOf(services.routine.profileHistory('nope'))).toBe('not_found');
    expect(await codeOf(services.routine.revision('nope'))).toBe('not_found');
  });

  it('add, update and setStatus each record one event and raise the revision once', async () => {
    const start = await services.routine.revision(IDS.ramesh);
    const added = await services.routine.add(IDS.ramesh, { productName: '  Vitamin D3   60000 ', ingredients: [{ name: 'Cholecalciferol', strength: 60000, unit: 'IU' }], form: 'capsule', dosesPerDay: null, instruction: ' weekly ' }, { status: 'taking', source: 'caregiver_reported', documentId: null });
    expect(added).toMatchObject({ productName: 'Vitamin D3 60000', instruction: 'weekly', ingredients: [{ name: 'cholecalciferol' }], status: 'taking', lastConfirmedAt: expect.any(String) });
    expect(await services.routine.revision(IDS.ramesh)).toBe(start + 1);

    const updated = await services.routine.update(added.id, { dosesPerDay: 1 });
    expect(updated.dosesPerDay).toBe(1);
    expect((await services.routine.history(added.id))[0]).toMatchObject({ type: 'changed', before: { dosesPerDay: null }, after: { dosesPerDay: 1 } });
    // The same values again: nothing.
    expect(await services.routine.update(added.id, { dosesPerDay: 1 })).toEqual(updated);
    expect(await services.routine.revision(IDS.ramesh)).toBe(start + 2);

    for (const [status, type] of [['uncertain', 'marked_uncertain'], ['not_started', 'not_started'], ['stopped', 'stopped'], ['taking', 'restarted'], ['taking', null]] as const) {
      await services.routine.setStatus(added.id, status);
      const [latest] = await services.routine.history(added.id);
      if (type) expect(latest.type).toBe(type);
    }
    expect((await services.routine.history(added.id)).length).toBe(6);
    expect(await services.routine.revision(IDS.ramesh)).toBe(start + 6);
    expect(await codeOf(services.routine.update(added.id, { productName: ' ' }))).toBe('unknown');
    expect(await codeOf(services.routine.update(added.id, { dosesPerDay: 0 }))).toBe('unknown');
    expect(await codeOf(services.routine.update(added.id, { ingredients: mg('x', -1) }))).toBe('unknown');
    expect(await codeOf(services.routine.setStatus('nope', 'taking'))).toBe('not_found');
    expect(await codeOf(services.routine.add('nope', added, { status: 'taking', source: 'patient_reported', documentId: null }))).toBe('not_found');
  });

  it('confirms an entry that was not confirmed', async () => {
    const confirmed = await services.routine.setStatus(M.atorvastatin10, 'taking');
    expect(confirmed).toMatchObject({ status: 'taking', lastConfirmedAt: expect.any(String) });
    expect((await services.routine.history(M.atorvastatin10))[0]).toMatchObject({ type: 'confirmed', detail: 'Confirmed as taken' });
  });

  it('resolveLegacy settles migrated entries in one batch', async () => {
    const base = await services.routine.get(M.atorvastatin10);
    const pending = [
      { ...base, id: 'legacy-1', productName: 'Old A', legacyReviewPending: true, source: 'legacy' as const },
      { ...base, id: 'legacy-2', productName: 'Old B', legacyReviewPending: true, source: 'from_pack' as const },
    ];
    await db.routine.bulkPut(pending);
    expect(await codeOf(services.routine.resolveLegacy(IDS.ramesh, [M.amlodipine10], []))).toBe('not_found');
    expect(await codeOf(services.routine.resolveLegacy(IDS.ramesh, ['legacy-1'], ['legacy-1']))).toBe('unknown');
    const resolved = await services.routine.resolveLegacy(IDS.ramesh, ['legacy-1'], ['legacy-2']);
    expect(resolved.map((m) => [m.id, m.status, m.source, m.legacyReviewPending])).toEqual([
      ['legacy-1', 'taking', 'caregiver_reported', false],
      ['legacy-2', 'stopped', 'from_pack', false],
    ]);
    expect(await codeOf(services.routine.resolveLegacy('nope', [], []))).toBe('not_found');
  });

  it('ingredient totals: paracetamol 3450 mg a day, complete', async () => {
    expect(await services.routine.ingredientTotals(IDS.ramesh)).toEqual(sampleCase.expected.ramesh.ingredientTotals);
    expect(await services.routine.ingredientTotals(IDS.lakshmi)).toEqual([]);
  });
});

describe('allergies and history', () => {
  it('lists allergies first, then conditions', async () => {
    expect((await services.health.list(IDS.ramesh)).map((h) => [h.kind, h.text])).toEqual([
      ['allergy', 'Sulfa drugs: rash'], ['condition', 'High blood pressure'], ['condition', 'Type 2 diabetes'],
    ]);
  });

  it('"No known allergies" is exclusive: adding a real allergy removes it', async () => {
    const [noneKnown] = await services.health.list(IDS.lakshmi);
    expect(noneKnown).toMatchObject({ kind: 'allergy', noneKnown: true, text: '' });
    const again = await services.health.add(IDS.lakshmi, { kind: 'allergy', text: '', noneKnown: true, source: 'caregiver_reported', documentId: null });
    expect(again.id).toBe(noneKnown.id);
    const penicillin = await services.health.add(IDS.lakshmi, { kind: 'allergy', text: ' Penicillin:  hives ', noneKnown: false, source: 'caregiver_reported', documentId: null });
    expect(penicillin.text).toBe('Penicillin: hives');
    expect((await services.health.list(IDS.lakshmi)).map((h) => h.text)).toEqual(['Penicillin: hives']);
    expect(await codeOf(services.health.add(IDS.lakshmi, { kind: 'allergy', text: '', noneKnown: true, source: 'caregiver_reported', documentId: null }))).toBe('unknown');
    // The same entry twice is kept once.
    expect((await services.health.add(IDS.lakshmi, { kind: 'allergy', text: 'penicillin: hives', noneKnown: false, source: 'caregiver_reported', documentId: null })).id).toBe(penicillin.id);
  });

  it('validates and removes entries', async () => {
    const base = { source: 'patient_reported' as const, documentId: null };
    expect(await codeOf(services.health.add(IDS.ramesh, { ...base, kind: 'condition', text: '', noneKnown: true }))).toBe('unknown');
    expect(await codeOf(services.health.add(IDS.ramesh, { ...base, kind: 'condition', text: '  ', noneKnown: false }))).toBe('unknown');
    expect(await codeOf(services.health.add(IDS.ramesh, { ...base, kind: 'allergy', text: '', noneKnown: true }))).toBe('unknown');
    expect(await codeOf(services.health.add(IDS.ramesh, { ...base, kind: 'note', text: 'x', noneKnown: false, documentId: IDS.documents.lakshmiThyroid }))).toBe('not_found');
    expect(await codeOf(services.health.add('nope', { ...base, kind: 'note', text: 'x', noneKnown: false }))).toBe('not_found');
    const note = await services.health.add(IDS.ramesh, { ...base, kind: 'procedure', text: 'Angioplasty, 2019', noneKnown: false, documentId: IDS.documents.ecg, source: 'from_document' });
    await services.health.remove(note.id);
    expect((await services.health.list(IDS.ramesh)).some((h) => h.id === note.id)).toBe(false);
    expect(await codeOf(services.health.remove(note.id))).toBe('not_found');
    expect(await codeOf(services.health.list('nope'))).toBe('not_found');
  });
});

describe('profiles stay apart', () => {
  it("a review for Ramesh never touches Lakshmi's routine, and a Lakshmi prescription never sees Ramesh's", async () => {
    const lakshmi = await routineOf(IDS.lakshmi);
    const { proposal } = await review(DEMO);
    await decide(proposal!, [lineRow(proposal!, 'Aspirin 75 mg'), 'started'], [lineRow(proposal!, 'Telmisartan 80 mg'), 'started_new']);
    expect(await routineOf(IDS.lakshmi)).toEqual(lakshmi);

    const mine = await review([line(0, 'Thyronorm 50 mcg', [{ name: 'levothyroxine', strength: 50, unit: 'mcg' }], 1, '1 tablet, before breakfast')], P.khan, await newPrescription(IDS.lakshmi));
    expect(mine.proposal).toBeNull();
    const other = await review([AMLODIPINE], P.khan, await newPrescription(IDS.lakshmi));
    expect(other.proposal!.rows.map((r) => [r.kind, r.medicine?.id ?? null])).toEqual([['new', null], ['not_mentioned', M.levothyroxine50]]);
  });
});
