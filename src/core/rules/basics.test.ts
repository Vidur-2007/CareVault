import { describe, expect, it } from 'vitest';
import { ServiceError } from '../../contract/legacy/types';
import {
  describeStrength,
  fromBaseUnit,
  ingredientKey,
  isMassUnit,
  normalizeIngredientName,
  normalizeIngredients,
  round3,
  sameMedicine,
  strengthSignature,
  toBaseUnit,
} from './normalize';
import { isActive, planAddMedicine, planConfirmMedicine, planSetStatus } from './status';
import { DR_A, ing, item, makeCtx, makeState, med, rx, storedLine, line, visit } from './testkit';
import {
  capitalize,
  countWord,
  dayAndMonth,
  joinNames,
  mediumDate,
  pronounsFor,
  shortDate,
  weekday,
} from './text';
import { applyPlan, emptyPlan, isEmptyPlan, mergePlans } from './types';
import { nextVisit, planAddQuestion } from './visits';

describe('normalizeIngredientName', () => {
  it.each([
    ['  Paracetamol  ', 'paracetamol'],
    ['Paracetamol IP', 'paracetamol'],
    ['Metformin Hydrochloride USP', 'metformin'],
    ['Metformin HCl', 'metformin'],
    ['Amlodipine Besylate', 'amlodipine'],
    ['Amlodipine Besilate BP', 'amlodipine'],
    ['Atorvastatin Calcium Trihydrate', 'atorvastatin'],
    ['Pantoprazole Sodium Sesquihydrate', 'pantoprazole'],
    ['Losartan Potassium', 'losartan'],
    ['Metoprolol Succinate', 'metoprolol'],
    ['Amlodipine (as besylate)', 'amlodipine'],
    ['Metformin Ph. Eur.', 'metformin'],
    ['Acetaminophen', 'paracetamol'],
    ['ACETAMINOPHEN USP', 'paracetamol'],
    ['Vitamin D3', 'cholecalciferol'],
    ['Acetylsalicylic Acid', 'aspirin'],
    ['Omega-3  Fatty   Acids', 'omega-3 fatty acids'],
  ])('%s -> %s', (raw, name) => {
    expect(normalizeIngredientName(raw)).toBe(name);
  });

  it('keeps mineral salts whole, because their last word is part of the name', () => {
    expect(normalizeIngredientName('Ferrous Sulphate')).toBe('ferrous sulphate');
    expect(normalizeIngredientName('Ferrous Fumarate')).toBe('ferrous fumarate');
    expect(normalizeIngredientName('Calcium Carbonate IP')).toBe('calcium carbonate');
    expect(normalizeIngredientName('Sodium')).toBe('sodium');
  });

  it('never strips a name down to nothing', () => {
    expect(normalizeIngredientName('Hydrochloride')).toBe('hydrochloride');
    expect(normalizeIngredientName('(Paracetamol)')).toBe('paracetamol');
    expect(normalizeIngredientName('')).toBe('');
    expect(normalizeIngredientName(' *** ')).toBe('');
    expect(normalizeIngredientName('()')).toBe('');
  });

  it('does not treat object property names as synonyms', () => {
    expect(normalizeIngredientName('toString')).toBe('tostring');
    expect(normalizeIngredientName('constructor')).toBe('constructor');
  });

  it('normalizes a list without touching strengths', () => {
    expect(normalizeIngredients([ing('Acetaminophen', 0.5, 'g'), ing('Caffeine IP', 30)])).toEqual([
      ing('paracetamol', 0.5, 'g'),
      ing('caffeine', 30),
    ]);
  });
});

describe('units', () => {
  it('converts mass to micrograms', () => {
    expect(toBaseUnit(0.5, 'g')).toEqual({ value: 500_000, unit: 'mcg' });
    expect(toBaseUnit(250, 'mg')).toEqual({ value: 250_000, unit: 'mcg' });
    expect(toBaseUnit(500, 'mcg')).toEqual({ value: 500, unit: 'mcg' });
  });

  it('leaves volume and international units alone', () => {
    expect(toBaseUnit(5, 'ml')).toEqual({ value: 5, unit: 'ml' });
    expect(toBaseUnit(60_000, 'IU')).toEqual({ value: 60_000, unit: 'IU' });
    expect(isMassUnit('mg')).toBe(true);
    expect(isMassUnit('ml')).toBe(false);
    expect(isMassUnit('IU')).toBe(false);
  });

  it('removes floating point noise', () => {
    expect(1.005 * 1000).not.toBe(1005);
    expect(toBaseUnit(1.005, 'mg').value).toBe(1005);
    expect(fromBaseUnit(1500, 'mg')).toBe(1.5);
    expect(fromBaseUnit(750_000, 'g')).toBe(0.75);
    expect(fromBaseUnit(5, 'ml')).toBe(5);
  });

  it('rounds to at most three decimals', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(1.0005)).toBe(1.001);
    expect(round3(2.34567)).toBe(2.346);
    expect(round3(3450)).toBe(3450);
  });
});

describe('sameMedicine', () => {
  it('matches on ingredients, whatever the brand, order, salt or spelling', () => {
    expect(sameMedicine([ing('Paracetamol IP', 650)], [ing('acetaminophen', 500)])).toBe(true);
    expect(sameMedicine([ing('amlodipine', 5), ing('telmisartan', 40)], [ing('Telmisartan', 80), ing('Amlodipine Besylate', 10)])).toBe(true);
  });

  it('needs the full set of a combination to match', () => {
    expect(sameMedicine([ing('amlodipine', 5), ing('telmisartan', 40)], [ing('amlodipine', 5)])).toBe(false);
    expect(sameMedicine([ing('paracetamol', 500)], [ing('paracetamol', 500), ing('caffeine', 30)])).toBe(false);
    expect(sameMedicine([ing('atorvastatin', 10)], [ing('rosuvastatin', 10)])).toBe(false);
  });

  it('ignores an ingredient listed twice', () => {
    expect(ingredientKey([ing('paracetamol', 500), ing('Paracetamol', 125)])).toBe('paracetamol');
  });

  it('describes and compares strengths', () => {
    expect(describeStrength([ing('amoxicillin', 500), ing('clavulanic acid', 125)])).toBe('500 mg + 125 mg');
    expect(strengthSignature([ing('paracetamol', 0.5, 'g')])).toBe(strengthSignature([ing('Paracetamol IP', 500)]));
    expect(strengthSignature([ing('paracetamol', 500)])).not.toBe(strengthSignature([ing('paracetamol', 650)]));
  });
});

describe('text', () => {
  it('formats dates from the text of the ISO string', () => {
    expect(shortDate('2026-10-28')).toBe('28 Oct');
    expect(shortDate('2026-08-05T23:59:00-11:00')).toBe('5 Aug');
    expect(mediumDate('2026-08-05')).toBe('5 Aug 2026');
    expect(dayAndMonth('2026-10-28')).toBe('28 October');
    expect(weekday('2026-11-12T20:05:00+05:30')).toBe('Thursday');
    expect(weekday('2026-11-14')).toBe('Saturday');
  });

  it('joins names and counts', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(countWord(2)).toBe('Two');
    expect(countWord(12)).toBe('12');
    expect(capitalize('amlodipine')).toBe('Amlodipine');
  });

  it('derives pronouns from the relation only', () => {
    expect(pronounsFor('Father')).toEqual({ subject: 'he', possessive: 'his', be: 'is' });
    expect(pronounsFor(' mother ')).toEqual({ subject: 'she', possessive: 'her', be: 'is' });
    expect(pronounsFor('Neighbour')).toEqual({ subject: 'they', possessive: 'their', be: 'are' });
    expect(pronounsFor(null)).toEqual({ subject: 'they', possessive: 'their', be: 'are' });
    expect(pronounsFor(undefined).subject).toBe('they');
  });
});

describe('status rules', () => {
  const fields = { productName: ' Dolo 650 ', ingredients: [ing('Paracetamol IP', 650)], form: 'tablet' as const, dosesPerDay: null, instruction: ' ' };

  it('active means at home, confirmed, or waiting for an answer', () => {
    expect(isActive({ status: 'found_at_home' })).toBe(true);
    expect(isActive({ status: 'confirmed_current' })).toBe(true);
    expect(isActive({ status: 'needs_confirmation' })).toBe(true);
    expect(isActive({ status: 'stopped' })).toBe(false);
  });

  it('a home scan is found_at_home, still extracted, with an added event', () => {
    const plan = planAddMedicine('p1', fields, { origin: 'home_scan', documentId: null, prescriberId: null }, makeCtx());
    expect(plan.medicines[0]).toMatchObject({
      productName: 'Dolo 650',
      ingredients: [ing('paracetamol', 650)],
      status: 'found_at_home',
      fieldState: 'extracted',
      origin: 'home_scan',
      dosesPerDay: null,
      instruction: '',
    });
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ type: 'added', detail: 'Found at home (scanned pack)', medicineId: plan.medicines[0].id });
  });

  it('a medicine typed by hand is found_at_home with confirmed fields', () => {
    const plan = planAddMedicine('p1', fields, { origin: 'manual', documentId: null, prescriberId: null }, makeCtx());
    expect(plan.medicines[0]).toMatchObject({ status: 'found_at_home', fieldState: 'confirmed' });
    expect(plan.events[0].detail).toBe('Added by hand');
  });

  it('a medicine taken straight from a prescription is confirmed_current', () => {
    const plan = planAddMedicine('p1', fields, { origin: 'prescription', documentId: 'doc-1', prescriberId: DR_A.id }, makeCtx());
    expect(plan.medicines[0]).toMatchObject({ status: 'confirmed_current', fieldState: 'confirmed', prescriberId: DR_A.id, sourceDocumentId: 'doc-1' });
    expect(plan.events[0]).toMatchObject({ detail: 'Added from a prescription', documentId: 'doc-1' });
  });

  it('confirming sets confirmed_current, confirmed fields and a confirmed event', () => {
    const ctx = makeCtx('2026-03-02T09:00:00+05:30');
    const medicine = med({ ingredients: [ing('paracetamol', 650)] });
    const plan = planConfirmMedicine(medicine, undefined, ctx);
    expect(plan.medicines[0]).toEqual({ ...medicine, status: 'confirmed_current', fieldState: 'confirmed', updatedAt: ctx.now });
    expect(plan.events[0]).toMatchObject({ type: 'confirmed', at: ctx.now });
  });

  it('confirming can correct the fields', () => {
    const medicine = med({ ingredients: [ing('paracetamol', 650)] });
    const plan = planConfirmMedicine(medicine, { dosesPerDay: 3, ingredients: [ing('Acetaminophen', 500)] }, makeCtx());
    expect(plan.medicines[0]).toMatchObject({ dosesPerDay: 3, ingredients: [ing('paracetamol', 500)], status: 'confirmed_current' });
  });

  it('setting a status records the matching event', () => {
    const medicine = med({ ingredients: [ing('paracetamol', 650)], status: 'confirmed_current' });
    expect(planSetStatus(medicine, 'stopped', makeCtx()).events[0].type).toBe('marked_stopped');
    expect(planSetStatus(medicine, 'needs_confirmation', makeCtx()).events[0].type).toBe('flagged_for_review');
    const stopped = { ...medicine, status: 'stopped' as const };
    expect(planSetStatus(stopped, 'confirmed_current', makeCtx()).events[0].type).toBe('confirmed');
    const home = planSetStatus(stopped, 'found_at_home', makeCtx());
    expect(home.medicines[0].status).toBe('found_at_home');
    expect(home.events).toEqual([]);
  });

  it('setting the status a medicine already has does nothing', () => {
    const medicine = med({ ingredients: [ing('paracetamol', 650)], status: 'stopped' });
    expect(isEmptyPlan(planSetStatus(medicine, 'stopped', makeCtx()))).toBe(true);
  });
});

describe('visits', () => {
  const past = visit({ id: 'past', at: '2026-02-01T10:00:00+05:30' });
  const soon = visit({ id: 'soon', at: '2026-03-10T10:30:00+05:30' });
  const later = visit({ id: 'later', at: '2026-04-01T09:00:00+05:30' });

  it('picks the earliest visit on or after today', () => {
    const state = makeState({ visits: [later, past, soon] });
    expect(nextVisit(state, '2026-03-01')?.id).toBe('soon');
    expect(nextVisit(state, '2026-03-10')?.id).toBe('soon');
    expect(nextVisit(state, '2026-03-11')?.id).toBe('later');
    expect(nextVisit(state, '2026-05-01')).toBeNull();
    expect(nextVisit(makeState(), '2026-03-01')).toBeNull();
    const sameTime = [visit({ id: 'b', at: soon.at }), visit({ id: 'a', at: soon.at })];
    expect(nextVisit(makeState({ visits: sameTime }), '2026-03-01')?.id).toBe('a');
  });

  it('adds a trimmed question once', () => {
    const ctx = makeCtx();
    const plan = planAddQuestion(soon, '  Is the  new dose right? ', 'manual', ctx);
    expect(plan.visits[0].questions).toEqual([{ id: 'question-1', text: 'Is the new dose right?', source: 'manual' }]);
    expect(isEmptyPlan(planAddQuestion(plan.visits[0], 'is the new dose right?', 'review', ctx))).toBe(true);
  });

  it('rejects an empty question', () => {
    expect(() => planAddQuestion(soon, '   ', 'manual', makeCtx())).toThrow(ServiceError);
  });
});

describe('write plans', () => {
  it('an empty plan is empty', () => {
    expect(isEmptyPlan(emptyPlan())).toBe(true);
    expect(isEmptyPlan({ ...emptyPlan(), deletedReviewItemIds: ['x'] })).toBe(false);
  });

  it('merging keeps the later version of a row and unions deletions', () => {
    const a = med({ ingredients: [ing('paracetamol', 650)] });
    const b = med({ ingredients: [ing('ibuprofen', 400)] });
    const merged = mergePlans(
      { ...emptyPlan(), medicines: [a, b], deletedDocumentIds: ['d1'], deletedReviewItemIds: ['r1'] },
      { ...emptyPlan(), medicines: [{ ...a, status: 'stopped' }], deletedDocumentIds: ['d1', 'd2'], deletedReviewItemIds: ['r2'] },
    );
    expect(merged.medicines).toEqual([{ ...a, status: 'stopped' }, b]);
    expect(merged.deletedDocumentIds).toEqual(['d1', 'd2']);
    expect(merged.deletedReviewItemIds).toEqual(['r1', 'r2']);
  });

  it('merging follows the order of events for deletions', () => {
    const question = item({ kind: 'possible_duplicate', id: 'q' });
    const doc = rx('doc-1', '2026-02-01');
    const deleteThenWrite = mergePlans(
      { ...emptyPlan(), deletedReviewItemIds: ['q'], deletedDocumentIds: ['doc-1'] },
      { ...emptyPlan(), reviewItems: [question], documents: [doc] },
    );
    expect(deleteThenWrite).toMatchObject({ reviewItems: [question], documents: [doc], deletedReviewItemIds: [], deletedDocumentIds: [] });
    const writeThenDelete = mergePlans(
      { ...emptyPlan(), reviewItems: [question], documents: [doc] },
      { ...emptyPlan(), deletedReviewItemIds: ['q'], deletedDocumentIds: ['doc-1'] },
    );
    expect(writeThenDelete).toMatchObject({ reviewItems: [], documents: [], deletedReviewItemIds: ['q'], deletedDocumentIds: ['doc-1'] });
  });

  it('applying a plan upserts rows and removes what was deleted', () => {
    const doc = rx('doc-1', '2026-02-01');
    const other = rx('doc-2', '2026-02-02');
    const kept = item({ kind: 'possible_duplicate', id: 'kept' });
    const dropped = item({ kind: 'new_document', id: 'dropped', documentId: 'doc-1' });
    const state = makeState({
      documents: [doc, other],
      prescriptionLines: [storedLine('doc-1', line('Amlodipine', 5)), storedLine('doc-2', line('Telmisartan', 40))],
      reviewItems: [kept, dropped],
      visits: [visit({ sharedDocumentIds: ['doc-1', 'doc-2'] }), visit({ id: 'visit-2', sharedDocumentIds: ['doc-2'] })],
    });
    const next = applyPlan(state, {
      ...emptyPlan(),
      documents: [{ ...other, starred: true }],
      deletedDocumentIds: ['doc-1'],
      deletedReviewItemIds: ['dropped'],
    });
    expect(next.documents).toEqual([{ ...other, starred: true }]);
    expect(next.prescriptionLines.map((l) => l.documentId)).toEqual(['doc-2']);
    expect(next.reviewItems).toEqual([kept]);
    expect(next.visits.map((v) => v.sharedDocumentIds)).toEqual([['doc-2'], ['doc-2']]);
    expect(next.visits[1]).toBe(state.visits[1]);
    expect(state.documents).toHaveLength(2);
  });
});
