import { describe, expect, it } from 'vitest';
import { buildChangeSummary, buildPassport } from './passport';
import { planPrescriptionApply, type LineInput } from './prescriptions';
import { planReviewResolution } from './review';
import { commit, DR_A, DR_B, ing, item, line, makeCtx, makeState, med, PROFILE, rx, visit } from './testkit';
import type { RulesState } from './types';

const TODAY = '2026-03-01';

function apply(state: RulesState, documentId: string, lines: LineInput[], prescriberId = DR_A.id) {
  const ctx = makeCtx('2026-03-01T10:00:00+05:30');
  ctx.newId = (kind, seed) => `${kind}:${seed}`;
  return commit(state, planPrescriptionApply(state, prescriberId, documentId, lines, ctx), ctx);
}

function twoPrescriptions() {
  let state = makeState({
    documents: [
      rx('rx-1', '2026-01-10'),
      rx('rx-2', '2026-02-20'),
      rx('report-old', '2026-02-01', null, { type: 'lab_report', title: 'Old report' }),
      rx('report-same-day', '2026-02-20', null, { type: 'lab_report', title: 'Lipid profile' }),
      rx('report-new', '2026-02-25', null, { type: 'test', title: 'ECG report', state: 'pending_confirmation' }),
    ],
    visits: [visit({ sharedDocumentIds: ['report-same-day', 'missing-document', 'report-new'] })],
  });
  state = apply(state, 'rx-1', [line('Atorvastatin', 10), line('Amlodipine', 5), line('Metformin', 500)]);
  state = apply(state, 'rx-2', [line('Rosuvastatin', 10), line('Amlodipine', 10), line('Metformin', 500, { instruction: '1 tablet, night' })]);
  return state;
}

describe('buildChangeSummary', () => {
  it('counts from the latest prescription of the next visit\'s prescriber', () => {
    expect(buildChangeSummary(twoPrescriptions(), TODAY)).toEqual({
      since: '2026-02-20',
      added: 1,
      changed: 2,
      toConfirm: 1,
      // Documents dated on or after 20 Feb, not counting the prescription itself.
      newDocuments: 2,
    });
  });

  it('no longer counts a medicine once the caregiver has answered', () => {
    const state = twoPrescriptions();
    const ctx = makeCtx();
    const answered = commit(state, planReviewResolution(state, state.reviewItems[0], 'still_taking', undefined, ctx), ctx);
    expect(buildChangeSummary(answered, TODAY)!.toConfirm).toBe(0);
  });

  it('is null without an upcoming visit, or when that prescriber has no prescription', () => {
    const state = twoPrescriptions();
    expect(buildChangeSummary({ ...state, visits: [] }, TODAY)).toBeNull();
    expect(buildChangeSummary(state, '2026-06-01')).toBeNull();
    expect(buildChangeSummary({ ...state, visits: [visit({ prescriberId: DR_B.id })] }, TODAY)).toBeNull();
  });

  it('does not count a medicine of another prescriber as waiting', () => {
    const state = twoPrescriptions();
    const moved = state.medicines.map((m) => (m.status === 'needs_confirmation' ? { ...m, prescriberId: DR_B.id } : m));
    expect(buildChangeSummary({ ...state, medicines: moved }, TODAY)!.toConfirm).toBe(0);
  });
});

describe('buildPassport', () => {
  it('lists confirmed medicines, changes, and what is still unconfirmed', () => {
    const passport = buildPassport(twoPrescriptions(), TODAY);
    expect(passport).toMatchObject({
      patientName: 'Meera Nair',
      patientAge: 76,
      preparedBy: 'Arun Nair, son',
      preparedOn: TODAY,
      visitAt: '2026-03-10T10:30:00+05:30',
      prescriberName: 'Dr. Asha Pillai',
      prescriberSpecialty: 'Cardiology',
      changesSince: '2026-01-10',
      questions: [],
    });
    expect(passport.currentMedicines.map((m) => m.productName)).toEqual(['Amlodipine 10 mg', 'Metformin 500 mg', 'Rosuvastatin 10 mg']);
    expect(passport.changes).toEqual([
      { kind: 'added', text: 'Rosuvastatin 10 mg, 1 tablet, morning (20 Feb)' },
      { kind: 'changed', text: 'Amlodipine from 5 mg to 10 mg, 1 tablet, morning (20 Feb)' },
      { kind: 'changed', text: 'Metformin 500 mg, "1 tablet, morning" to "1 tablet, night" (20 Feb)' },
      { kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not on the 20 Feb prescription' },
    ]);
    // Shared documents that still exist, in the order chosen.
    expect(passport.documents).toEqual([
      { title: 'Lipid profile', documentDate: '2026-02-20' },
      { title: 'ECG report', documentDate: '2026-02-25' },
    ]);
  });

  it('never lists an unconfirmed or stopped medicine as current', () => {
    const passport = buildPassport(twoPrescriptions(), TODAY);
    const names = passport.currentMedicines.map((m) => m.productName);
    expect(names).not.toContain('Atorvastatin 10 mg');
    expect(names).not.toContain('Amlodipine 5 mg');
  });

  it('drops the unconfirmed line once the caregiver answers', () => {
    const state = twoPrescriptions();
    const ctx = makeCtx();
    const stopped = commit(state, planReviewResolution(state, state.reviewItems[0], 'stopped', undefined, ctx), ctx);
    expect(buildPassport(stopped, TODAY).changes.filter((c) => c.kind === 'unconfirmed')).toEqual([]);
  });

  it('keeps "ask the doctor" medicines on the passport as unconfirmed', () => {
    const state = twoPrescriptions();
    const ctx = makeCtx();
    const parked = commit(state, planReviewResolution(state, state.reviewItems[0], 'ask_doctor', undefined, ctx), ctx);
    const passport = buildPassport(parked, TODAY);
    expect(passport.changes.at(-1)).toEqual({ kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not on the 20 Feb prescription' });
    expect(passport.questions).toEqual(['Does Rosuvastatin replace Atorvastatin, or should she take both?']);
  });

  it('shows other medicines that wait for an answer as unconfirmed too', () => {
    const state = twoPrescriptions();
    const other = med({ productName: 'Glimepiride 1 mg', ingredients: [ing('glimepiride', 1)], prescriberId: DR_B.id, status: 'needs_confirmation' });
    const passport = buildPassport({ ...state, medicines: [...state.medicines, other] }, TODAY);
    expect(passport.changes.slice(-2)).toEqual([
      { kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not on the 20 Feb prescription' },
      { kind: 'unconfirmed', text: 'Glimepiride 1 mg is not confirmed as currently taken' },
    ]);
  });

  it('a first prescription has no changes to report', () => {
    const state = apply(makeState({ documents: [rx('rx-1', '2026-01-10')], visits: [visit()] }), 'rx-1', [line('Amlodipine', 5)]);
    const passport = buildPassport(state, TODAY);
    expect(passport.changesSince).toBeNull();
    expect(passport.changes).toEqual([]);
    expect(passport.currentMedicines).toHaveLength(1);
  });

  it('without a visit it still lists medicines and what is unconfirmed', () => {
    const state = { ...twoPrescriptions(), visits: [] };
    const passport = buildPassport({ ...state, profile: { ...PROFILE, birthYear: null } }, TODAY);
    expect(passport).toMatchObject({
      patientAge: null,
      visitAt: null,
      prescriberName: null,
      prescriberSpecialty: null,
      changesSince: null,
      documents: [],
      questions: [],
    });
    expect(passport.changes).toEqual([{ kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not confirmed as currently taken' }]);
    expect(passport.currentMedicines).toHaveLength(3);
  });

  it('handles a visit whose prescriber is unknown or has no prescription', () => {
    const state = twoPrescriptions();
    const unknown = buildPassport({ ...state, visits: [visit({ prescriberId: 'dr-gone' })] }, TODAY);
    expect(unknown.prescriberName).toBeNull();
    expect(unknown.changes.map((c) => c.kind)).toEqual(['unconfirmed']);
    const noRx = buildPassport({ ...state, visits: [visit({ prescriberId: DR_B.id })] }, TODAY);
    expect(noRx.prescriberName).toBe('Dr. Bala Krishnan');
    expect(noRx.changesSince).toBeNull();
  });

  it("puts the visit prescriber's medicines first, then other prescribers, then the rest", () => {
    const mk = (productName: string, prescriberId: string | null) =>
      med({ productName, ingredients: [ing(productName.toLowerCase(), 1)], prescriberId, status: 'confirmed_current' });
    const state = makeState({
      medicines: [mk('Zinc', null), mk('Metformin', DR_B.id), mk('Telmisartan', DR_A.id), mk('Aspirin', null), mk('Amlodipine', DR_A.id), mk('Glimepiride', DR_B.id)],
      visits: [visit()],
    });
    expect(buildPassport(state, TODAY).currentMedicines).toEqual([
      { productName: 'Amlodipine', instruction: '1 tablet, morning', prescriberName: 'Dr. Asha Pillai' },
      { productName: 'Telmisartan', instruction: '1 tablet, morning', prescriberName: 'Dr. Asha Pillai' },
      { productName: 'Glimepiride', instruction: '1 tablet, morning', prescriberName: 'Dr. Bala Krishnan' },
      { productName: 'Metformin', instruction: '1 tablet, morning', prescriberName: 'Dr. Bala Krishnan' },
      { productName: 'Aspirin', instruction: '1 tablet, morning', prescriberName: null },
      { productName: 'Zinc', instruction: '1 tablet, morning', prescriberName: null },
    ]);
    const noVisit = buildPassport({ ...state, visits: [] }, TODAY).currentMedicines.map((m) => m.productName);
    expect(noVisit).toEqual(['Amlodipine', 'Telmisartan', 'Glimepiride', 'Metformin', 'Aspirin', 'Zinc']);
  });

  describe('flags', () => {
    const a = med({ productName: 'Dolo 650', ingredients: [ing('paracetamol', 650)] });
    const b = med({ productName: 'Crocin Advance 500', ingredients: [ing('paracetamol', 500)] });
    const c = med({ productName: 'Calpol 500', ingredients: [ing('paracetamol', 500)] });
    const prescribed = med({ productName: 'P-500', ingredients: [ing('paracetamol', 500)], prescriberId: DR_A.id, origin: 'prescription', status: 'confirmed_current' });
    const duplicate = (ids: string[], overrides = {}) => item({ kind: 'possible_duplicate', title: 'Two products at home contain paracetamol', medicineIds: ids, ...overrides });
    const flagsOf = (state: RulesState) => buildPassport(state, TODAY).flags;

    it('restates an open duplicate question', () => {
      expect(flagsOf(makeState({ medicines: [a, b], reviewItems: [duplicate([a.id, b.id])] }))).toEqual([
        'Two products at home contain paracetamol: Dolo 650 and Crocin Advance 500. Neither is on a prescription in these records.',
      ]);
    });

    it('words three products, and leaves out the prescription sentence when one is prescribed', () => {
      expect(flagsOf(makeState({ medicines: [a, b, c], reviewItems: [duplicate([a.id, b.id, c.id], { title: 'Three products at home contain paracetamol' })] }))).toEqual([
        'Three products at home contain paracetamol: Dolo 650, Crocin Advance 500 and Calpol 500. None of them is on a prescription in these records.',
      ]);
      expect(flagsOf(makeState({ medicines: [a, prescribed], reviewItems: [duplicate([a.id, prescribed.id], { title: 'Two products contain paracetamol' })] }))).toEqual([
        'Two products contain paracetamol: Dolo 650 and P-500.',
      ]);
      const typedIn = { ...prescribed, prescriberId: null };
      expect(flagsOf(makeState({ medicines: [a, typedIn], reviewItems: [duplicate([a.id, typedIn.id], { title: 'T' })] }))).toEqual(['T: Dolo 650 and P-500.']);
    });

    it('keeps a duplicate parked for the doctor, and drops one that was dismissed or settled', () => {
      const resolved = (resolution: 'ask_doctor' | 'dismissed' | 'only_one') =>
        makeState({ medicines: [a, b], reviewItems: [duplicate([a.id, b.id], { resolvedAt: '2026-02-28T10:00:00+05:30', resolution })] });
      expect(flagsOf(resolved('ask_doctor'))).toHaveLength(1);
      expect(flagsOf(resolved('dismissed'))).toEqual([]);
      expect(flagsOf(resolved('only_one'))).toEqual([]);
    });

    it('drops a flag when fewer than two of its medicines are still active', () => {
      const stopped = { ...b, status: 'stopped' as const };
      expect(flagsOf(makeState({ medicines: [a, stopped], reviewItems: [duplicate([a.id, b.id])] }))).toEqual([]);
      expect(flagsOf(makeState({ medicines: [a], reviewItems: [duplicate([a.id, 'gone'])] }))).toEqual([]);
      expect(flagsOf(makeState({ medicines: [a, b], reviewItems: [item({ kind: 'confirm_medicine', medicineIds: [a.id, b.id] })] }))).toEqual([]);
    });
  });
});
