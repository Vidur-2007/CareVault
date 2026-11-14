import { describe, expect, it } from 'vitest';
import { ServiceError, type Medicine, type ReviewItem } from '../../contract/types';
import { planPrescriptionApply } from './prescriptions';
import {
  expectedReviewItems,
  planReviewRefresh,
  planReviewResolution,
  questionFor,
  withoutStrength,
  withReviewRefresh,
} from './review';
import { planSetStatus } from './status';
import { commit, DR_A, ing, item, line, makeCtx, makeState, med, PROFILE, rx, visit } from './testkit';
import { applyPlan, emptyPlan, isEmptyPlan, type RulesState } from './types';

const ctx = () => makeCtx('2026-03-01T10:00:00+05:30');
/** A context whose ids are unique across calls, for flows with several steps. */
const seeded = () => ({ ...ctx(), newId: (kind: string, seed: string) => `${kind}:${seed}` });
const refresh = (state: RulesState) => applyPlan(state, planReviewRefresh(state, ctx()));
const open = (state: RulesState) => state.reviewItems.filter((r) => r.resolvedAt === null);

const dolo = () => med({ productName: 'Dolo 650', ingredients: [ing('paracetamol', 650)], dosesPerDay: 3 });
const crocin = () => med({ productName: 'Crocin Advance 500', ingredients: [ing('paracetamol', 500)], dosesPerDay: 3 });
const calpol = () => med({ productName: 'Calpol 500', ingredients: [ing('paracetamol', 500)], prescriberId: DR_A.id, origin: 'prescription', status: 'confirmed_current' });

describe('expectedReviewItems: possible duplicates', () => {
  it('opens one item for two products with the same ingredient, and never a second', () => {
    const a = dolo();
    const b = crocin();
    const once = refresh(makeState({ medicines: [a, b] }));
    expect(once.reviewItems).toEqual([
      expect.objectContaining({
        kind: 'possible_duplicate',
        title: 'Two products at home contain paracetamol',
        body: 'Dolo 650 and Crocin Advance 500 are different brands of the same ingredient. Please check with a pharmacist before both are used on the same day.',
        medicineIds: [a.id, b.id],
        documentId: null,
        resolvedAt: null,
      }),
    ]);
    expect(expectedReviewItems(once, ctx())).toEqual([]);
    expect(refresh(refresh(once))).toEqual(once);
  });

  it('opens nothing for a single product or for stopped products', () => {
    expect(refresh(makeState({ medicines: [dolo()] })).reviewItems).toEqual([]);
    expect(refresh(makeState({ medicines: [dolo(), { ...crocin(), status: 'stopped' }] })).reviewItems).toEqual([]);
  });

  it('words three products, not all from home scans', () => {
    const state = refresh(makeState({ medicines: [dolo(), crocin(), calpol()] }));
    expect(state.reviewItems).toHaveLength(1);
    expect(state.reviewItems[0]).toMatchObject({
      title: 'Three products contain paracetamol',
      body: 'Dolo 650, Crocin Advance 500 and Calpol 500 are different brands of the same ingredient. Please check with a pharmacist before they are used on the same day.',
    });
  });

  it('opens one item for a set of combination products that share two ingredients', () => {
    const a = med({ productName: 'Combiflam', ingredients: [ing('ibuprofen', 400), ing('paracetamol', 325)] });
    const b = med({ productName: 'Ibugesic Plus', ingredients: [ing('ibuprofen', 400), ing('paracetamol', 325)] });
    const state = refresh(makeState({ medicines: [a, b] }));
    expect(state.reviewItems).toHaveLength(1);
    expect(state.reviewItems[0]).toMatchObject({
      title: 'Two products at home contain ibuprofen and paracetamol',
      body: 'Combiflam and Ibugesic Plus all contain ibuprofen and paracetamol. Please check with a pharmacist before both are used on the same day.',
    });
  });

  it('opens separate items for different sets of medicines', () => {
    const combo = med({ productName: 'Combiflam', ingredients: [ing('ibuprofen', 400), ing('paracetamol', 325)] });
    const state = refresh(makeState({ medicines: [combo, dolo(), med({ productName: 'Brufen 400', ingredients: [ing('ibuprofen', 400)] })] }));
    expect(state.reviewItems.map((r) => r.title).sort()).toEqual([
      'Two products at home contain ibuprofen',
      'Two products at home contain paracetamol',
    ]);
  });

  it('stays quiet about a set the caregiver has parked for the doctor or dismissed', () => {
    const a = dolo();
    const b = crocin();
    for (const resolution of ['ask_doctor', 'dismissed'] as const) {
      const answered = item({ kind: 'possible_duplicate', medicineIds: [b.id, a.id], resolvedAt: '2026-02-20T10:00:00+05:30', resolution });
      expect(expectedReviewItems(makeState({ medicines: [a, b], reviewItems: [answered] }), ctx())).toEqual([]);
    }
  });

  it('asks again when a set comes back after "only one of these"', () => {
    const a = dolo();
    const b = crocin();
    const answered = item({ kind: 'possible_duplicate', medicineIds: [a.id, b.id], resolvedAt: '2026-02-20T10:00:00+05:30', resolution: 'only_one' });
    expect(expectedReviewItems(makeState({ medicines: [a, b], reviewItems: [answered] }), ctx())).toHaveLength(1);
  });

  it('replaces the open item when a third product joins, and removes it when the duplicate is gone', () => {
    const a = dolo();
    const b = crocin();
    let state = refresh(makeState({ medicines: [a, b] }));
    const first = state.reviewItems[0].id;

    state = refresh({ ...state, medicines: [...state.medicines, calpol()] });
    expect(state.reviewItems).toHaveLength(1);
    expect(first).toBeDefined();
    expect(state.reviewItems[0].medicineIds).toHaveLength(3);

    const stopped = state.medicines.map((m, i): Medicine => (i > 0 ? { ...m, status: 'stopped' } : m));
    expect(refresh({ ...state, medicines: stopped }).reviewItems).toEqual([]);
  });
});

describe('expectedReviewItems: new documents', () => {
  const email = rx('mail-1', '2026-02-27', null, { type: 'lab_report', title: 'HbA1c report', source: 'email', state: 'pending_confirmation', addedAt: '2026-02-27T20:05:00+05:30' });

  it('opens an item for an unconfirmed document that arrived by email', () => {
    const state = refresh(makeState({ documents: [email] }));
    expect(state.reviewItems).toEqual([
      expect.objectContaining({
        kind: 'new_document',
        title: 'Add this HbA1c report to her records?',
        body: 'A PDF arrived in the connected inbox on Friday, 27 February. It looks like a lab report for Meera Nair. Nothing is saved until you confirm.',
        documentId: 'mail-1',
        createdAt: email.addedAt,
        medicineIds: [],
      }),
    ]);
    expect(expectedReviewItems(state, ctx())).toEqual([]);
  });

  it('words other file and document types', () => {
    const scan = { ...email, id: 'mail-2', type: 'discharge_summary' as const, title: 'Discharge summary', mimeType: 'image/jpeg' };
    expect(refresh(makeState({ documents: [scan] })).reviewItems[0].body).toContain('A file arrived');
    expect(refresh(makeState({ documents: [scan] })).reviewItems[0].body).toContain('a discharge summary');
  });

  it('opens nothing for uploads, confirmed documents, or documents already asked about', () => {
    const upload = { ...email, id: 'up-1', source: 'upload' as const };
    const confirmed = { ...email, id: 'mail-3', state: 'confirmed' as const };
    expect(refresh(makeState({ documents: [upload, confirmed] })).reviewItems).toEqual([]);
    const answered = item({ kind: 'new_document', documentId: 'mail-1', resolvedAt: '2026-02-28T10:00:00+05:30', resolution: 'dismissed' });
    expect(expectedReviewItems(makeState({ documents: [email], reviewItems: [answered] }), ctx())).toEqual([]);
  });

  it('closes the item as added once the document is confirmed, and removes it if the document is gone', () => {
    const state = refresh(makeState({ documents: [email] }));
    const confirmed = refresh({ ...state, documents: [{ ...email, state: 'confirmed' }] });
    expect(confirmed.reviewItems[0]).toMatchObject({ resolution: 'added', resolvedAt: '2026-03-01T10:00:00+05:30' });
    expect(refresh({ ...state, documents: [] }).reviewItems).toEqual([]);
  });
});

describe('expectedReviewItems: medicines waiting for confirmation', () => {
  const waiting = () => med({ productName: 'Atorvastatin 10 mg', ingredients: [ing('atorvastatin', 10)], status: 'needs_confirmation', updatedAt: '2026-02-20T10:00:00+05:30' });

  it('opens a question for a flagged medicine that has none', () => {
    const m = waiting();
    const state = refresh(makeState({ medicines: [m] }));
    expect(state.reviewItems).toEqual([
      expect.objectContaining({ kind: 'confirm_medicine', title: 'Is she still taking Atorvastatin 10 mg?', medicineIds: [m.id], documentId: null }),
    ]);
    expect(expectedReviewItems(state, ctx())).toEqual([]);
    const they = refresh(makeState({ profile: { ...PROFILE, relation: '' }, medicines: [m] }));
    expect(they.reviewItems[0].title).toBe('Are they still taking Atorvastatin 10 mg?');
  });

  it('does not reopen a question parked for the doctor, unless the medicine changed since', () => {
    const m = waiting();
    const parked = item({ kind: 'confirm_medicine', medicineIds: [m.id], resolvedAt: '2026-02-21T10:00:00+05:30', resolution: 'ask_doctor' });
    expect(expectedReviewItems(makeState({ medicines: [m], reviewItems: [parked] }), ctx())).toEqual([]);
    const flaggedAgain = { ...m, updatedAt: '2026-02-25T10:00:00+05:30' };
    expect(expectedReviewItems(makeState({ medicines: [flaggedAgain], reviewItems: [parked] }), ctx())).toHaveLength(1);
    const otherAnswer = { ...parked, resolution: 'still_taking' as const };
    expect(expectedReviewItems(makeState({ medicines: [m], reviewItems: [otherAnswer] }), ctx())).toHaveLength(1);
  });

  it('closes an open question with the answer the status now shows', () => {
    const cases: [Medicine['status'][], ReviewItem['resolution'] | 'kept' | 'removed'][] = [
      [['stopped'], 'stopped'],
      [['confirmed_current'], 'still_taking'],
      [['found_at_home'], 'dismissed'],
      [['stopped', 'confirmed_current'], 'dismissed'],
      [['stopped', 'needs_confirmation'], 'kept'],
      [[], 'removed'],
    ];
    for (const [statuses, outcome] of cases) {
      const medicines = statuses.map((status) => ({ ...waiting(), status }));
      const question = item({ kind: 'confirm_medicine', medicineIds: medicines.length ? medicines.map((m) => m.id) : ['gone'] });
      const state = refresh(makeState({ medicines, reviewItems: [question] }));
      if (outcome === 'removed') expect(state.reviewItems).toEqual([]);
      else if (outcome === 'kept') expect(state.reviewItems).toEqual([question]);
      else expect(state.reviewItems[0]).toMatchObject({ id: question.id, resolution: outcome });
    }
  });

  it('leaves other kinds of open item alone', () => {
    const unclear = item({ kind: 'unclear_extraction' });
    expect(isEmptyPlan(planReviewRefresh(makeState({ reviewItems: [unclear] }), ctx()))).toBe(true);
  });

  it('reopens the question when a stop is reversed by setting the status back', () => {
    const m = waiting();
    let state = refresh(makeState({ medicines: [m] }));
    const c = ctx();
    state = commit(state, planReviewResolution(state, state.reviewItems[0], 'stopped', undefined, c), c);
    expect(open(state)).toEqual([]);
    const later = makeCtx('2026-03-01T10:05:00+05:30');
    state = commit(state, planSetStatus(state.medicines[0], 'needs_confirmation', later), later);
    expect(open(state)).toHaveLength(1);
    expect(state.medicines[0].status).toBe('needs_confirmation');
  });
});

describe('planReviewResolution', () => {
  function scene() {
    const atorvastatin = med({ productName: 'Atorvastatin 10 mg', ingredients: [ing('atorvastatin', 10)], status: 'needs_confirmation', fieldState: 'confirmed' });
    const a = dolo();
    const b = crocin();
    const confirm = item({ kind: 'confirm_medicine', medicineIds: [atorvastatin.id] });
    const duplicate = item({ kind: 'possible_duplicate', medicineIds: [a.id, b.id] });
    const state = makeState({ medicines: [atorvastatin, a, b], reviewItems: [confirm, duplicate], visits: [visit()] });
    return { state, atorvastatin, a, b, confirm, duplicate };
  }

  const resolve = (state: RulesState, target: ReviewItem, resolution: NonNullable<ReviewItem['resolution']>, opts?: { keepMedicineId?: string }) => {
    const c = ctx();
    return commit(state, planReviewResolution(state, target, resolution, opts, c), c);
  };

  it('still taking: confirmed_current, with a confirmed event', () => {
    const { state, atorvastatin, confirm } = scene();
    const next = resolve(state, confirm, 'still_taking');
    expect(next.medicines[0]).toMatchObject({ id: atorvastatin.id, status: 'confirmed_current', fieldState: 'confirmed', updatedAt: '2026-03-01T10:00:00+05:30' });
    expect(next.events).toEqual([expect.objectContaining({ type: 'confirmed', medicineId: atorvastatin.id })]);
    expect(next.reviewItems[0]).toMatchObject({ resolution: 'still_taking', resolvedAt: '2026-03-01T10:00:00+05:30' });
  });

  it('stopped: stopped, with a marked_stopped event', () => {
    const { state, atorvastatin, confirm } = scene();
    const next = resolve(state, confirm, 'stopped');
    expect(next.medicines[0].status).toBe('stopped');
    expect(next.events).toEqual([expect.objectContaining({ type: 'marked_stopped', medicineId: atorvastatin.id, detail: 'Marked as stopped by the caregiver' })]);
    expect(next.reviewItems[0].resolution).toBe('stopped');
  });

  it('ask the doctor: status unchanged, a question on the next visit, item resolved', () => {
    const { state, confirm } = scene();
    const next = resolve(state, confirm, 'ask_doctor');
    expect(next.medicines).toEqual(state.medicines);
    expect(next.events).toEqual([]);
    expect(next.visits[0].questions).toEqual([
      { id: expect.any(String), text: 'Should she still take Atorvastatin? It is not on the latest prescription.', source: 'review' },
    ]);
    expect(next.reviewItems[0].resolution).toBe('ask_doctor');
    // Parked, not reopened.
    expect(open(next).map((r) => r.kind)).toEqual(['possible_duplicate']);
  });

  it('ask the doctor about a missing medicine names what the prescription added', () => {
    let state = makeState({ documents: [rx('rx-1', '2026-01-10'), rx('rx-2', '2026-02-20')], visits: [visit()] });
    for (const [id, lines] of [['rx-1', [line('Atorvastatin', 10)]], ['rx-2', [line('Rosuvastatin', 10)]]] as const) {
      const c = seeded();
      state = commit(state, planPrescriptionApply(state, DR_A.id, id, [...lines], c), c);
    }
    expect(questionFor(state, open(state)[0])).toBe('Does Rosuvastatin replace Atorvastatin, or should she take both?');
    const next = resolve(state, open(state)[0], 'ask_doctor');
    expect(next.visits[0].questions.map((q) => q.text)).toEqual(['Does Rosuvastatin replace Atorvastatin, or should she take both?']);
  });

  it('words the question for several added medicines', () => {
    let state = makeState({ documents: [rx('rx-1', '2026-01-10'), rx('rx-2', '2026-02-20')] });
    for (const [id, lines] of [['rx-1', [line('Atorvastatin', 10)]], ['rx-2', [line('Rosuvastatin', 10), line('Ezetimibe', 10)]]] as const) {
      const c = seeded();
      state = commit(state, planPrescriptionApply(state, DR_A.id, id, [...lines], c), c);
    }
    expect(questionFor(state, open(state)[0])).toBe('Do Rosuvastatin and Ezetimibe replace Atorvastatin, or should she take all of them?');
  });

  it('ask the doctor about a duplicate', () => {
    const { state, duplicate } = scene();
    const next = resolve(state, duplicate, 'ask_doctor');
    expect(next.visits[0].questions.map((q) => q.text)).toEqual([
      'Can she use Dolo 650 and Crocin Advance 500 on the same day? Both contain paracetamol.',
    ]);
    expect(next.medicines).toEqual(state.medicines);
  });

  it('words a duplicate question for three products, stopped ones included, and with no shared ingredient left', () => {
    const { state, a, b } = scene();
    const c = { ...calpol(), status: 'stopped' as const };
    const three = item({ kind: 'possible_duplicate', medicineIds: [a.id, b.id, c.id] });
    expect(questionFor({ ...state, medicines: [...state.medicines, c] }, three)).toBe(
      'Can she use Dolo 650, Crocin Advance 500 and Calpol 500 on the same day? They all contain paracetamol.',
    );
    const edited = state.medicines.map((m) => (m.id === b.id ? { ...m, ingredients: [ing('ibuprofen', 400)] } : m));
    expect(questionFor({ ...state, medicines: edited }, item({ kind: 'possible_duplicate', medicineIds: [a.id, b.id] }))).toBe(
      'Can she use Dolo 650 and Crocin Advance 500 on the same day?',
    );
  });

  it('falls back to the item title for anything else', () => {
    const { state } = scene();
    expect(questionFor(state, item({ kind: 'unclear_extraction', title: 'Check the strength of Dolo' }))).toBe('Please check: Check the strength of Dolo');
    expect(questionFor(state, item({ kind: 'possible_duplicate', title: 'One left', medicineIds: ['gone'] }))).toBe('Please check: One left');
    expect(questionFor(state, item({ kind: 'confirm_medicine', title: 'Gone', medicineIds: [] }))).toBe('Please check: Gone');
  });

  it('does not repeat a question the visit already has about the same products', () => {
    const { state, confirm, duplicate } = scene();
    const asked = visit({
      questions: [
        { id: 'q1', text: 'Does Rosuvastatin replace Atorvastatin, or should she take both?', source: 'manual' },
        { id: 'q2', text: 'Can she use Dolo 650 and Crocin Advance on the same day?', source: 'manual' },
      ],
    });
    let next = resolve({ ...state, visits: [asked] }, confirm, 'ask_doctor');
    next = resolve(next, duplicate, 'ask_doctor');
    expect(next.visits).toEqual([asked]);
    expect(open(next)).toEqual([]);
  });

  it('ask the doctor with no visit booked still resolves the item', () => {
    const { state, confirm } = scene();
    const next = resolve({ ...state, visits: [] }, confirm, 'ask_doctor');
    expect(next.visits).toEqual([]);
    expect(next.reviewItems[0].resolution).toBe('ask_doctor');
    const documentQuestion = item({ kind: 'new_document', id: 'doc-q', documentId: 'none' });
    expect(resolve(state, documentQuestion, 'ask_doctor').visits[0].questions[0].text).toBe('Please check: A question');
  });

  it('only one: stops every product except the one that is kept', () => {
    const { state, a, b, duplicate } = scene();
    const next = resolve(state, duplicate, 'only_one', { keepMedicineId: a.id });
    expect(next.medicines.find((m) => m.id === a.id)!.status).toBe('found_at_home');
    expect(next.medicines.find((m) => m.id === b.id)!.status).toBe('stopped');
    expect(next.events).toEqual([
      expect.objectContaining({ medicineId: b.id, type: 'marked_stopped', detail: 'Marked as stopped: only one of these products is taken' }),
    ]);
    expect(next.reviewItems.find((r) => r.id === duplicate.id)!.resolution).toBe('only_one');
  });

  it('only one: skips a product that is already stopped', () => {
    const { state, a, b, duplicate } = scene();
    const already = state.medicines.map((m) => (m.id === b.id ? { ...m, status: 'stopped' as const } : m));
    const plan = planReviewResolution({ ...state, medicines: already }, duplicate, 'only_one', { keepMedicineId: a.id }, ctx());
    expect(plan.medicines).toEqual([]);
    expect(plan.events).toEqual([]);
  });

  it('only one: refuses without a valid choice, so nothing is stopped by accident', () => {
    const { state, duplicate } = scene();
    expect(() => planReviewResolution(state, duplicate, 'only_one', undefined, ctx())).toThrow(ServiceError);
    expect(() => planReviewResolution(state, duplicate, 'only_one', {}, ctx())).toThrow('choose');
    expect(() => planReviewResolution(state, duplicate, 'only_one', { keepMedicineId: 'not-in-item' }, ctx())).toThrow(ServiceError);
  });

  it('added: confirms the document', () => {
    const email = rx('mail-1', '2026-02-27', null, { type: 'lab_report', source: 'email', state: 'pending_confirmation' });
    const question = item({ kind: 'new_document', documentId: 'mail-1' });
    const state = makeState({ documents: [email], reviewItems: [question] });
    const next = resolve(state, question, 'added');
    expect(next.documents[0].state).toBe('confirmed');
    expect(next.reviewItems[0].resolution).toBe('added');
    const again = planReviewResolution({ ...state, documents: [{ ...email, state: 'confirmed' }] }, question, 'added', undefined, ctx());
    expect(again.documents).toEqual([]);
    expect(planReviewResolution({ ...state, documents: [] }, question, 'added', undefined, ctx()).documents).toEqual([]);
  });

  it('dismissed: removes an unconfirmed document, and nothing else', () => {
    const email = rx('mail-1', '2026-02-27', null, { type: 'lab_report', source: 'email', state: 'pending_confirmation' });
    const question = item({ kind: 'new_document', documentId: 'mail-1' });
    const state = makeState({ documents: [email], reviewItems: [question], visits: [visit({ sharedDocumentIds: ['mail-1'] })] });
    const next = resolve(state, question, 'dismissed');
    expect(next.documents).toEqual([]);
    expect(next.visits[0].sharedDocumentIds).toEqual([]);
    expect(next.reviewItems[0].resolution).toBe('dismissed');

    const kept = planReviewResolution({ ...state, documents: [{ ...email, state: 'confirmed' }] }, question, 'dismissed', undefined, ctx());
    expect(kept.deletedDocumentIds).toEqual([]);
    const { state: other, duplicate } = scene();
    const dismissedDuplicate = resolve(other, duplicate, 'dismissed');
    expect(dismissedDuplicate.medicines).toEqual(other.medicines);
    expect(open(dismissedDuplicate).map((r) => r.kind)).toEqual(['confirm_medicine']);
    const withDocument = item({ kind: 'unclear_extraction', id: 'u', documentId: 'mail-1' });
    expect(planReviewResolution(state, withDocument, 'dismissed', undefined, ctx()).deletedDocumentIds).toEqual([]);
  });

  it('an item that is already resolved changes nothing', () => {
    const { state, confirm } = scene();
    const done = { ...confirm, resolvedAt: '2026-02-28T10:00:00+05:30', resolution: 'stopped' as const };
    expect(isEmptyPlan(planReviewResolution(state, done, 'still_taking', undefined, ctx()))).toBe(true);
  });

  it('ignores medicines that no longer exist', () => {
    const { state } = scene();
    const orphan = item({ kind: 'confirm_medicine', id: 'orphan', medicineIds: ['gone'] });
    const plan = planReviewResolution(state, orphan, 'stopped', undefined, ctx());
    expect(plan.medicines).toEqual([]);
    expect(plan.reviewItems).toEqual([expect.objectContaining({ id: 'orphan', resolution: 'stopped' })]);
  });
});

describe('helpers', () => {
  it('strips a trailing strength from a product name', () => {
    expect(withoutStrength('Rosuvastatin 10 mg')).toBe('Rosuvastatin');
    expect(withoutStrength('Thyronorm 25mcg tablets')).toBe('Thyronorm');
    expect(withoutStrength('Dolo 650')).toBe('Dolo 650');
    expect(withoutStrength('Calcirol 60000 IU')).toBe('Calcirol');
    expect(withoutStrength(' 10 mg')).toBe(' 10 mg');
  });

  it('withReviewRefresh adds the refresh to a plan', () => {
    const a = dolo();
    const b = crocin();
    const plan = withReviewRefresh(makeState({ medicines: [a] }), { ...emptyPlan(), medicines: [b] }, ctx());
    expect(plan.medicines).toEqual([b]);
    expect(plan.reviewItems.map((r) => r.kind)).toEqual(['possible_duplicate']);
  });
});
