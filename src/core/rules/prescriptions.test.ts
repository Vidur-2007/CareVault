import { describe, expect, it } from 'vitest';
import { ServiceError, type PrescriptionLine } from '../../contract/types';
import { describeChange, diffPrescriptions, linesIdentical, reviewNote } from './diff';
import { buildDiff, planPrescriptionApply, prescriptionsFrom } from './prescriptions';
import { commit, DR_A, DR_B, ing, item, line, makeCtx, makeState, med, PROFILE, rx, storedLine } from './testkit';
import { pronounsFor } from './text';
import { isEmptyPlan, type RulesState } from './types';

const stored = (name: string, strength: number, overrides = {}) => storedLine('doc', line(name, strength, overrides));

describe('diffPrescriptions', () => {
  it('a first prescription produces only added rows', () => {
    const rows = diffPrescriptions(null, [stored('Amlodipine', 5), stored('Telmisartan', 40)]);
    expect(rows.map((r) => r.kind)).toEqual(['added', 'added']);
    expect(rows.every((r) => r.previous === null)).toBe(true);
    expect(rows[0].note).toBe('First prescription from this prescriber in CareVault');
  });

  it('classifies added, changed, review and unchanged, in that order', () => {
    const before = [stored('Telmisartan', 40), stored('Atorvastatin', 10), stored('Amlodipine', 5)];
    const after = [stored('Telmisartan', 40), stored('Amlodipine', 10), stored('Rosuvastatin', 10)];
    const rows = diffPrescriptions(before, after, pronounsFor('Father'));
    expect(rows.map((r) => [r.kind, r.previous?.productName ?? null, r.latest?.productName ?? null])).toEqual([
      ['added', null, 'Rosuvastatin 10 mg'],
      ['changed', 'Amlodipine 5 mg', 'Amlodipine 10 mg'],
      ['review', 'Atorvastatin 10 mg', null],
      ['unchanged', 'Telmisartan 40 mg', 'Telmisartan 40 mg'],
    ]);
    expect(rows[0].note).toBe('New on this prescription');
    expect(rows[1].note).toBe('5 mg to 10 mg');
    expect(rows[2].note).toBe('CareVault does not assume it was stopped. Please confirm what he is taking.');
    expect(rows[3].note).toBe('');
  });

  it('words the review note for she and they', () => {
    expect(reviewNote(pronounsFor('Mother'))).toContain('what she is taking');
    const rows = diffPrescriptions([stored('Atorvastatin', 10)], []);
    expect(rows[0].note).toContain('what they are taking');
  });

  it('matches on ingredients, never on brand names', () => {
    const before = [stored('Amlodipine', 5, { productName: 'Amlong 5' })];
    const after = [stored('Amlodipine', 5, { productName: 'Stamlo 5', ingredients: [ing('Amlodipine Besylate IP', 5)] })];
    expect(diffPrescriptions(before, after).map((r) => r.kind)).toEqual(['unchanged']);
    const renamed = [stored('Rosuvastatin', 5, { productName: 'Amlong 5' })];
    expect(diffPrescriptions(before, renamed).map((r) => r.kind)).toEqual(['added', 'review']);
  });

  it('treats the same amount in another unit as unchanged', () => {
    const before = [stored('Metformin', 500)];
    const after = [stored('Metformin', 0.5, { ingredients: [ing('metformin', 0.5, 'g')] })];
    expect(diffPrescriptions(before, after)[0].kind).toBe('unchanged');
  });

  it('needs the full set of a combination to match', () => {
    const combo = stored('Telma-AM', 40, { ingredients: [ing('telmisartan', 40), ing('amlodipine', 5)] });
    const rows = diffPrescriptions([combo], [stored('Amlodipine', 5)]);
    expect(rows.map((r) => r.kind)).toEqual(['added', 'review']);
    const stronger = stored('Telma-AM', 80, { ingredients: [ing('amlodipine', 5), ing('telmisartan', 80)] });
    const changed = diffPrescriptions([combo], [stronger]);
    expect(changed[0]).toMatchObject({ kind: 'changed', note: '40 mg + 5 mg to 5 mg + 80 mg' });
  });

  it('describes each kind of change', () => {
    const base = stored('Metformin', 500, { dosesPerDay: 1, instruction: '1 tablet, morning' });
    expect(describeChange(base, { ...base, dosesPerDay: 2 })).toBe('1 a day to 2 a day');
    expect(describeChange(base, { ...base, dosesPerDay: null })).toBe('1 a day to not stated');
    expect(describeChange(base, { ...base, form: 'capsule' })).toBe('tablet to capsule');
    expect(describeChange(base, { ...base, instruction: '1 tablet, night' })).toBe('"1 tablet, morning" to "1 tablet, night"');
    expect(describeChange(base, { ...base, ingredients: [ing('metformin', 1000)], dosesPerDay: 2 })).toBe('500 mg to 1000 mg, 1 a day to 2 a day');
  });

  it('ignores case and spacing in the instruction', () => {
    const base = stored('Metformin', 500);
    expect(linesIdentical(base, { ...base, instruction: '  1 Tablet,  Morning ' })).toBe(true);
    expect(linesIdentical(base, { ...base, instruction: '1 tablet, night' })).toBe(false);
    expect(linesIdentical(base, { ...base, dosesPerDay: 2 })).toBe(false);
    expect(linesIdentical(base, { ...base, form: 'capsule' })).toBe(false);
    expect(diffPrescriptions([base], [{ ...base, id: 'x', instruction: '1 tablet, night' }])[0].kind).toBe('changed');
  });

  it('pairs repeated lines for the same medicine in order', () => {
    const morning = stored('Amlodipine', 5, { instruction: '1 tablet, morning' });
    const night = stored('Amlodipine', 10, { instruction: '1 tablet, night' });
    const rows = diffPrescriptions([morning, night], [{ ...morning, id: 'a' }, { ...night, id: 'b' }, stored('Amlodipine', 2.5)]);
    expect(rows.map((r) => r.kind)).toEqual(['added', 'unchanged', 'unchanged']);
    const fewer = diffPrescriptions([morning, night], [{ ...morning, id: 'c' }]);
    expect(fewer.map((r) => [r.kind, r.previous?.id])).toEqual([['review', night.id], ['unchanged', morning.id]]);
  });
});

/** Applies a prescription the way the services do and returns the new state. */
function apply(state: RulesState, documentId: string, lines: ReturnType<typeof line>[], prescriberId = DR_A.id, now = '2026-03-01T10:00:00+05:30') {
  const ctx = makeCtx(now);
  ctx.newId = (kind, seed) => `${kind}:${seed}`;
  return commit(state, planPrescriptionApply(state, prescriberId, documentId, lines, ctx), ctx);
}

const statusOf = (state: RulesState, name: string) =>
  state.medicines.filter((m) => m.productName === name).map((m) => m.status);

describe('planPrescriptionApply', () => {
  const first = rx('rx-1', '2026-01-10');
  const second = rx('rx-2', '2026-02-20');
  const third = rx('rx-3', '2026-03-15');
  const base = () => makeState({ documents: [first, second, third, rx('rx-b', '2026-02-01', DR_B.id)] });

  it('the first prescription from a prescriber only adds medicines and opens no review item', () => {
    const state = apply(base(), 'rx-1', [line('Amlodipine', 5), line('Telmisartan', 40)]);
    expect(state.medicines.map((m) => [m.productName, m.status, m.origin, m.fieldState, m.prescriberId, m.sourceDocumentId])).toEqual([
      ['Amlodipine 5 mg', 'confirmed_current', 'prescription', 'confirmed', DR_A.id, 'rx-1'],
      ['Telmisartan 40 mg', 'confirmed_current', 'prescription', 'confirmed', DR_A.id, 'rx-1'],
    ]);
    expect(state.events.map((e) => [e.type, e.detail, e.documentId])).toEqual([
      ['added', 'Added from the prescription of Dr. Asha Pillai, 10 Jan 2026', 'rx-1'],
      ['added', 'Added from the prescription of Dr. Asha Pillai, 10 Jan 2026', 'rx-1'],
    ]);
    expect(state.reviewItems).toEqual([]);
    expect(state.prescriptionLines).toHaveLength(2);
    expect(state.prescriptionLines[0]).toMatchObject({ id: 'line:rx-1:0', documentId: 'rx-1', fieldState: 'confirmed' });
  });

  it('cleans up what it stores: trimmed names, normalized ingredients', () => {
    const state = apply(base(), 'rx-1', [
      line('Amlodipine', 5, { productName: '  Amlong 5 ', ingredients: [ing('Amlodipine Besylate IP', 5)], instruction: ' 1 tablet, morning ' }),
    ]);
    expect(state.prescriptionLines[0]).toMatchObject({ productName: 'Amlong 5', ingredients: [ing('amlodipine', 5)], instruction: '1 tablet, morning' });
    expect(state.medicines[0]).toMatchObject({ productName: 'Amlong 5', ingredients: [ing('amlodipine', 5)] });
  });

  it('applying the same prescription twice changes nothing the second time', () => {
    const once = apply(base(), 'rx-1', [line('Amlodipine', 5)]);
    const ctx = makeCtx();
    expect(isEmptyPlan(planPrescriptionApply(once, DR_A.id, 'rx-1', [line('Amlodipine', 5)], ctx))).toBe(true);
    expect(isEmptyPlan(planPrescriptionApply(once, DR_A.id, 'rx-1', [line('Rosuvastatin', 10)], ctx))).toBe(true);
    expect(apply(once, 'rx-1', [line('Amlodipine', 5)])).toEqual(once);
  });

  it('a changed strength replaces the medicine and links old to new', () => {
    let state = apply(base(), 'rx-1', [line('Amlodipine', 5)]);
    state = apply(state, 'rx-2', [line('Amlodipine', 10)]);
    const old = state.medicines.find((m) => m.productName === 'Amlodipine 5 mg')!;
    const current = state.medicines.find((m) => m.productName === 'Amlodipine 10 mg')!;
    expect(old).toMatchObject({ status: 'stopped', replacedByMedicineId: current.id });
    expect(current).toMatchObject({ status: 'confirmed_current', sourceDocumentId: 'rx-2', replacedByMedicineId: null });
    expect(state.events.slice(1).map((e) => [e.medicineId, e.type, e.detail])).toEqual([
      [old.id, 'replaced', 'Replaced by Amlodipine 10 mg'],
      [current.id, 'strength_changed', '5 mg to 10 mg'],
    ]);
    expect(state.reviewItems).toEqual([]);
  });

  it('a changed instruction or number per day is an instruction change', () => {
    let state = apply(base(), 'rx-1', [line('Metformin', 500, { dosesPerDay: 1 })]);
    state = apply(state, 'rx-2', [line('Metformin', 500, { dosesPerDay: 2, instruction: '1 tablet, twice a day' })]);
    expect(statusOf(state, 'Metformin 500 mg')).toEqual(['stopped', 'confirmed_current']);
    expect(state.events.at(-1)).toMatchObject({ type: 'instruction_changed', detail: '1 a day to 2 a day' });
  });

  it('an identical line changes nothing', () => {
    const before = apply(base(), 'rx-1', [line('Telmisartan', 40)]);
    const after = apply(before, 'rx-2', [line('Telmisartan', 40, { productName: 'Telma 40' })]);
    expect(after.medicines).toEqual(before.medicines);
    expect(after.events).toEqual(before.events);
    expect(after.reviewItems).toEqual([]);
  });

  it('a medicine missing from the new prescription needs confirmation and is never stopped', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10), line('Telmisartan', 40)]);
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    const atorvastatin = state.medicines.find((m) => m.productName === 'Atorvastatin 10 mg')!;
    expect(atorvastatin.status).toBe('needs_confirmation');
    expect(state.medicines.some((m) => m.status === 'stopped')).toBe(false);
    expect(state.events.at(-1)).toMatchObject({
      type: 'flagged_for_review',
      medicineId: atorvastatin.id,
      detail: 'Not on the prescription of Dr. Asha Pillai, 20 Feb 2026',
    });
    expect(state.reviewItems).toEqual([
      expect.objectContaining({
        kind: 'confirm_medicine',
        title: 'Is she still taking Atorvastatin 10 mg?',
        body: "It is in the home inventory, but it is missing from Dr. Asha Pillai's prescription of 20 February.",
        medicineIds: [atorvastatin.id],
        documentId: 'rx-2',
        resolvedAt: null,
      }),
    ]);
    expect(buildDiff(state, DR_A.id)!.rows[0]).toMatchObject({ kind: 'review', reviewItemId: state.reviewItems[0].id });
  });

  it('names what the new prescription adds, and says "they" when the relation is unknown', () => {
    let state = apply({ ...base(), profile: { ...PROFILE, relation: 'Neighbour' } }, 'rx-1', [line('Atorvastatin', 10)]);
    state = apply(state, 'rx-2', [line('Rosuvastatin', 10), line('Ezetimibe', 10)]);
    expect(state.reviewItems[0]).toMatchObject({
      title: 'Are they still taking Atorvastatin 10 mg?',
      body: "It is in the home inventory, but it is missing from Dr. Asha Pillai's prescription of 20 February, which adds Rosuvastatin 10 mg and Ezetimibe 10 mg.",
    });
  });

  it("a prescription from prescriber B never changes prescriber A's medicines", () => {
    let state = apply(base(), 'rx-1', [line('Amlodipine', 5), line('Atorvastatin', 10)]);
    const mine = state.medicines;
    state = apply(state, 'rx-b', [line('Amlodipine', 10), line('Metformin', 500)], DR_B.id);
    expect(state.medicines.slice(0, 2)).toEqual(mine);
    expect(state.medicines.slice(2).map((m) => [m.productName, m.prescriberId, m.status])).toEqual([
      ['Amlodipine 10 mg', DR_B.id, 'confirmed_current'],
      ['Metformin 500 mg', DR_B.id, 'confirmed_current'],
    ]);
    expect(state.reviewItems.filter((r) => r.kind === 'confirm_medicine')).toEqual([]);
    expect(buildDiff(state, DR_B.id)!.rows.map((r) => r.kind)).toEqual(['added', 'added']);
  });

  it('never touches medicines found at home, even with the same ingredient', () => {
    const home = med({ ingredients: [ing('amlodipine', 5)], status: 'found_at_home' });
    let state = apply({ ...base(), medicines: [home] }, 'rx-1', [line('Amlodipine', 5)]);
    state = apply(state, 'rx-2', [line('Amlodipine', 10)]);
    expect(state.medicines.find((m) => m.id === home.id)).toEqual(home);
  });

  it('a medicine that comes back on a later prescription is confirmed again and its question closed', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10), line('Telmisartan', 40)]);
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    state = apply(state, 'rx-3', [line('Telmisartan', 40), line('Atorvastatin', 10)], DR_A.id, '2026-03-15T12:00:00+05:30');
    expect(statusOf(state, 'Atorvastatin 10 mg')).toEqual(['confirmed_current']);
    expect(state.events.at(-1)).toMatchObject({ type: 'confirmed', detail: 'On the prescription of Dr. Asha Pillai, 15 Mar 2026' });
    expect(state.reviewItems).toEqual([expect.objectContaining({ resolution: 'still_taking', resolvedAt: '2026-03-15T12:00:00+05:30' })]);
  });

  it('a medicine that comes back at another strength replaces the one in question', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10)]);
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    state = apply(state, 'rx-3', [line('Telmisartan', 40), line('Atorvastatin', 20)]);
    expect(statusOf(state, 'Atorvastatin 10 mg')).toEqual(['stopped']);
    expect(statusOf(state, 'Atorvastatin 20 mg')).toEqual(['confirmed_current']);
    expect(state.reviewItems[0].resolution).toBe('dismissed');
    expect(state.events.at(-1)).toMatchObject({ type: 'strength_changed', detail: '10 mg to 20 mg' });
  });

  it('does not open a second question for a medicine that is already in question', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10), line('Telmisartan', 40)]);
    state = apply(state, 'rx-2', [line('Atorvastatin', 10)]);
    const telmisartanItem = state.reviewItems[0];
    // The third prescription still has no Telmisartan: same question, nothing new.
    const eventsBefore = state.events.length;
    state = apply(state, 'rx-3', [line('Atorvastatin', 10)]);
    expect(state.reviewItems).toEqual([telmisartanItem]);
    expect(state.events).toHaveLength(eventsBefore);
  });

  it('opens a question without a second event when the medicine was already flagged by hand', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10)]);
    state = { ...state, medicines: state.medicines.map((m) => ({ ...m, status: 'needs_confirmation' as const })) };
    const eventsBefore = state.events.length;
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    expect(state.events.filter((e) => e.type === 'flagged_for_review')).toEqual([]);
    expect(state.events).toHaveLength(eventsBefore + 1);
    expect(state.reviewItems.map((r) => [r.kind, r.documentId])).toEqual([['confirm_medicine', 'rx-2']]);
  });

  it('adds nothing when the missing medicine already has an open question', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10)]);
    const flagged = state.medicines.map((m) => ({ ...m, status: 'needs_confirmation' as const }));
    const question = item({ kind: 'confirm_medicine', medicineIds: [flagged[0].id] });
    state = { ...state, medicines: flagged, reviewItems: [question] };
    const before = state;
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    expect(state.reviewItems).toEqual([question]);
    expect(state.events.filter((e) => e.type === 'flagged_for_review')).toEqual([]);
    expect(state.medicines.find((m) => m.id === flagged[0].id)).toEqual(before.medicines[0]);
  });

  it('respects a stop the caregiver already made', () => {
    let state = apply(base(), 'rx-1', [line('Atorvastatin', 10), line('Telmisartan', 40), line('Amlodipine', 5), line('Metformin', 500)]);
    state = { ...state, medicines: state.medicines.map((m) => ({ ...m, status: 'stopped' as const })) };
    state = apply(state, 'rx-2', [
      line('Telmisartan', 40),
      line('Amlodipine', 10),
      line('Metformin', 500, { instruction: '1 tablet, night' }),
    ]);
    // Unchanged line: stays stopped. Missing line: no question about a stopped medicine.
    expect(statusOf(state, 'Telmisartan 40 mg')).toEqual(['stopped']);
    expect(statusOf(state, 'Atorvastatin 10 mg')).toEqual(['stopped']);
    expect(state.reviewItems).toEqual([]);
    // Changed lines are new information from the prescriber.
    expect(statusOf(state, 'Amlodipine 10 mg')).toEqual(['confirmed_current']);
    expect(state.events.slice(-2).map((e) => [e.type, e.detail])).toEqual([
      ['strength_changed', '5 mg to 10 mg'],
      ['instruction_changed', '"1 tablet, morning" to "1 tablet, night"'],
    ]);
    expect(state.medicines.find((m) => m.productName === 'Amlodipine 5 mg')!.replacedByMedicineId).toBeNull();
  });

  it('leaves an identical medicine this prescriber already has alone', () => {
    const existing = med({ productName: 'Amlodipine 5 mg', ingredients: [ing('amlodipine', 5)], prescriberId: DR_A.id, status: 'confirmed_current', origin: 'manual' });
    const state = apply({ ...base(), medicines: [existing] }, 'rx-1', [line('Amlodipine', 5)]);
    expect(state.medicines).toEqual([existing]);
    expect(state.events).toEqual([]);
  });

  it('uses the newest of two matching medicines', () => {
    const older = med({ id: 'older', productName: 'Amlodipine 5 mg', ingredients: [ing('amlodipine', 5)], prescriberId: DR_A.id, status: 'confirmed_current', createdAt: '2026-01-01T10:00:00+05:30' });
    const newer = { ...older, id: 'newer', createdAt: '2026-01-05T10:00:00+05:30' };
    const twin = { ...older, id: 'newer-twin', createdAt: '2026-01-05T10:00:00+05:30' };
    const state = apply({ ...base(), medicines: [older, twin, newer] }, 'rx-1', [line('Amlodipine', 10)]);
    expect(state.medicines.filter((m) => m.status === 'stopped').map((m) => m.id)).toEqual(['newer']);
  });

  it('a prescription older than one already stored only stores its lines', () => {
    let state = apply(base(), 'rx-2', [line('Amlodipine', 10)]);
    const medicines = state.medicines;
    state = apply(state, 'rx-1', [line('Amlodipine', 5), line('Atorvastatin', 10)]);
    expect(state.medicines).toEqual(medicines);
    expect(state.prescriptionLines).toHaveLength(3);
    expect(state.reviewItems).toEqual([]);
    expect(buildDiff(state, DR_A.id)!.rows.map((r) => r.kind)).toEqual(['changed', 'review']);
  });

  it('files the document as a prescription from the chosen prescriber', () => {
    const upload = rx('scan-1', '2026-02-01', null, { type: 'other' });
    const state = apply(makeState({ documents: [upload] }), 'scan-1', [line('Amlodipine', 5)]);
    expect(state.documents[0]).toMatchObject({ type: 'prescription', prescriberId: DR_A.id });
    const wrongDoctor = rx('scan-2', '2026-02-01', DR_B.id);
    expect(apply(makeState({ documents: [wrongDoctor] }), 'scan-2', [line('Amlodipine', 5)]).documents[0].prescriberId).toBe(DR_A.id);
  });

  it('rejects a document or prescriber that is not in the records', () => {
    const ctx = makeCtx();
    expect(() => planPrescriptionApply(base(), DR_A.id, 'nope', [], ctx)).toThrow(ServiceError);
    expect(() => planPrescriptionApply(base(), 'dr-nobody', 'rx-1', [], ctx)).toThrow('prescriber');
  });
});

describe('buildDiff', () => {
  it('is null when the prescriber has no stored prescription, or the document is not theirs', () => {
    const state = makeState({ documents: [rx('rx-1', '2026-01-10')] });
    expect(buildDiff(state, DR_A.id)).toBeNull();
    const applied = apply(state, 'rx-1', [line('Amlodipine', 5)]);
    expect(buildDiff(applied, DR_A.id, 'rx-unknown')).toBeNull();
    expect(buildDiff(applied, DR_B.id)).toBeNull();
  });

  it('can compare an earlier prescription with the one before it', () => {
    let state = makeState({ documents: [rx('rx-1', '2026-01-10'), rx('rx-2', '2026-02-20'), rx('rx-3', '2026-03-15')] });
    state = apply(state, 'rx-1', [line('Amlodipine', 5)]);
    state = apply(state, 'rx-2', [line('Amlodipine', 10)]);
    state = apply(state, 'rx-3', [line('Amlodipine', 10)]);
    expect(buildDiff(state, DR_A.id)).toMatchObject({ previousDocumentId: 'rx-2', latestDocumentId: 'rx-3' });
    expect(buildDiff(state, DR_A.id, 'rx-2')).toMatchObject({ previousDocumentId: 'rx-1', latestDocumentId: 'rx-2' });
    expect(buildDiff(state, DR_A.id, 'rx-1')).toMatchObject({ previousDocumentId: null, latestDocumentId: 'rx-1' });
  });

  it('orders prescriptions by date, then by when they were added, then by id', () => {
    const lines = (id: string): PrescriptionLine => storedLine(id, line('Amlodipine', 5));
    const a = rx('b-same-day', '2026-02-01', DR_A.id, { addedAt: '2026-02-01T09:00:00+05:30' });
    const b = rx('a-same-day', '2026-02-01', DR_A.id, { addedAt: '2026-02-01T09:00:00+05:30' });
    const c = rx('later-upload', '2026-02-01', DR_A.id, { addedAt: '2026-02-01T18:00:00+05:30' });
    const d = rx('earlier-date', '2026-01-01', DR_A.id, { addedAt: '2026-03-01T09:00:00+05:30' });
    const noLines = rx('no-lines', '2026-04-01');
    const report = rx('report', '2026-04-01', DR_A.id, { type: 'lab_report' });
    const state = makeState({
      documents: [c, a, noLines, report, b, d],
      prescriptionLines: [lines(a.id), lines(b.id), lines(c.id), lines(d.id), lines(report.id)],
    });
    expect(prescriptionsFrom(state, DR_A.id).map((doc) => doc.id)).toEqual(['earlier-date', 'a-same-day', 'b-same-day', 'later-upload']);
  });

  it('links a review row to its open question, or to the answered one when none is open', () => {
    let state = makeState({ documents: [rx('rx-1', '2026-01-10'), rx('rx-2', '2026-02-20')] });
    state = apply(state, 'rx-1', [line('Atorvastatin', 10)]);
    state = apply(state, 'rx-2', [line('Telmisartan', 40)]);
    const open = state.reviewItems[0];
    const answered = { ...open, id: 'answered-earlier', resolvedAt: '2026-02-21T10:00:00+05:30', resolution: 'ask_doctor' as const };
    const unrelated = item({ kind: 'confirm_medicine', id: 'unrelated', documentId: 'rx-2', medicineIds: ['missing-medicine'] });
    expect(buildDiff({ ...state, reviewItems: [unrelated, answered, open] }, DR_A.id)!.rows[1].reviewItemId).toBe(open.id);
    expect(buildDiff({ ...state, reviewItems: [answered] }, DR_A.id)!.rows[1].reviewItemId).toBe('answered-earlier');
    expect(buildDiff({ ...state, reviewItems: [unrelated] }, DR_A.id)!.rows[1].reviewItemId).toBeNull();
  });
});
