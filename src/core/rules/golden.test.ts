// The golden test. It starts from the raw inputs of the sample case (overview spec
// section 10) and runs them, in the order they happened, through the same rules the app
// uses. Everything the fixtures expect must come out, down to ids, wording and timestamps.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  expected,
  IDS,
  SAMPLE_TODAY,
  sampleDocuments,
  sampleEvents,
  sampleMedicines,
  samplePrescribers,
  samplePrescriptionLines,
  sampleProfile,
  sampleReviewItems,
  sampleVisit,
} from '../../contract/fixtures/sampleCase';
import type { ID, ISODateTime, MedicineStatus } from '../../contract/types';
import { buildChangeSummary, buildPassport } from './passport';
import { buildDiff, planPrescriptionApply, type LineInput } from './prescriptions';
import { expectedReviewItems, planReviewRefresh, withReviewRefresh } from './review';
import { planAddMedicine, planSetStatus } from './status';
import { ingredientTotals } from './totals';
import { applyPlan, emptyPlan, isEmptyPlan, type IdKind, type RuleContext, type RulesState, type WritePlan } from './types';

const M = IDS.medicines;
const L = IDS.lines;
const D = IDS.documents;
const P = IDS.prescribers;

// The rules ask for an id by describing what it is for. The sample case has fixed ids,
// so each description maps to one of them. An unexpected request fails the test.
const MEDICINE_IDS: Record<string, ID> = {
  [L.raoPrevAmlodipine]: M.amlodipine5,
  [L.raoPrevTelmisartan]: M.telmisartan40,
  [L.raoPrevAtorvastatin]: M.atorvastatin10,
  [L.raoLatestAmlodipine]: M.amlodipine10,
  [L.raoLatestRosuvastatin]: M.rosuvastatin10,
  [L.menonMetformin]: M.metformin500,
  'home_scan:Dolo 650': M.dolo650,
  'home_scan:Crocin Advance 500': M.crocinAdvance500,
  'manual:Pantoprazole 40 mg': M.pantoprazole40,
};

const REVIEW_IDS: Record<string, ID> = {
  [`confirm_medicine:${M.atorvastatin10}`]: IDS.reviewItems.confirmAtorvastatin,
  'possible_duplicate:paracetamol': IDS.reviewItems.duplicateParacetamol,
  [`new_document:${D.hba1c}`]: IDS.reviewItems.newDocumentHba1c,
};

function fixtureId(kind: IdKind, seed: string): ID {
  let id: ID | undefined;
  if (kind === 'medicine') id = MEDICINE_IDS[seed];
  if (kind === 'reviewItem') id = REVIEW_IDS[seed];
  if (kind === 'event') {
    const [type, medicineId] = seed.split(':');
    id = sampleEvents.find((e) => e.type === type && e.medicineId === medicineId)?.id;
  }
  if (!id) throw new Error(`The sample case has no ${kind} for "${seed}"`);
  return id;
}

const at = (now: ISODateTime): RuleContext => ({ now, today: now.slice(0, 10), newId: fixtureId });

const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const linesFor = (documentId: ID): LineInput[] =>
  samplePrescriptionLines
    .filter((l) => l.documentId === documentId)
    .map(({ id, productName, ingredients, form, dosesPerDay, instruction }) => ({
      id,
      productName,
      ingredients,
      form,
      dosesPerDay,
      instruction,
    }));

const doc = (id: ID) => sampleDocuments.find((d) => d.id === id)!;

let state: RulesState;

function step(now: ISODateTime, build: (s: RulesState, ctx: RuleContext) => WritePlan) {
  const ctx = at(now);
  state = applyPlan(state, withReviewRefresh(state, build(state, ctx), ctx));
}

function receive(documentId: ID) {
  const record = doc(documentId);
  step(record.addedAt, () => ({ ...emptyPlan(), documents: [record] }));
}

beforeAll(() => {
  state = {
    profile: sampleProfile,
    prescribers: samplePrescribers,
    medicines: [],
    events: [],
    documents: [],
    prescriptionLines: [],
    reviewItems: [],
    // The visit and its two questions were typed in by the caregiver.
    visits: [sampleVisit],
  };

  // 1 Jun: Pantoprazole typed in by hand.
  step('2026-06-01T09:30:00+05:30', (s, ctx) =>
    planAddMedicine(
      s.profile.id,
      {
        productName: 'Pantoprazole 40 mg',
        ingredients: [{ name: 'Pantoprazole', strength: 40, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: 1,
        instruction: '1 tablet, before breakfast',
      },
      { origin: 'manual', documentId: null, prescriberId: null },
      ctx,
    ),
  );

  // 14 Jul: Dr. Menon's prescription.
  receive(D.menon);
  step('2026-07-14T11:20:00+05:30', (s, ctx) => planPrescriptionApply(s, P.menon, D.menon, linesFor(D.menon), ctx));

  // 5 Aug: Dr. Rao's first prescription; that evening Pantoprazole is marked stopped.
  receive(D.raoPrevious);
  step('2026-08-05T12:35:00+05:30', (s, ctx) =>
    planPrescriptionApply(s, P.rao, D.raoPrevious, linesFor(D.raoPrevious), ctx),
  );
  step('2026-08-05T19:00:00+05:30', (s, ctx) =>
    planSetStatus(s.medicines.find((m) => m.id === M.pantoprazole40)!, 'stopped', ctx),
  );

  // 15 Sep: ECG report.
  receive(D.ecg);

  // 28 Oct: Dr. Rao's second prescription.
  receive(D.raoLatest);
  step('2026-10-28T13:15:00+05:30', (s, ctx) =>
    planPrescriptionApply(s, P.rao, D.raoLatest, linesFor(D.raoLatest), ctx),
  );

  // 10 Nov: two packs scanned at home.
  step('2026-11-10T19:00:00+05:30', (s, ctx) =>
    planAddMedicine(
      s.profile.id,
      {
        productName: 'Dolo 650',
        ingredients: [{ name: 'Paracetamol IP', strength: 650, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: 3,
        instruction: '1 tablet, three times a day',
      },
      { origin: 'home_scan', documentId: null, prescriberId: null },
      ctx,
    ),
  );
  step('2026-11-10T19:05:00+05:30', (s, ctx) =>
    planAddMedicine(
      s.profile.id,
      {
        productName: 'Crocin Advance 500',
        ingredients: [{ name: 'Acetaminophen', strength: 500, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: 3,
        instruction: '1 tablet, three times a day',
      },
      { origin: 'home_scan', documentId: null, prescriberId: null },
      ctx,
    ),
  );

  // 12 Nov: the lipid profile is uploaded, the HbA1c report arrives by email.
  receive(D.lipidProfile);
  receive(D.hba1c);
});

describe('golden test: the sample case', () => {
  it('ends with exactly the medicines of the fixtures', () => {
    expect(byId(state.medicines)).toEqual(byId(sampleMedicines));
  });

  it('puts every medicine in its expected status', () => {
    const statuses: MedicineStatus[] = ['confirmed_current', 'needs_confirmation', 'found_at_home', 'stopped'];
    for (const status of statuses) {
      const ids = state.medicines.filter((m) => m.status === status).map((m) => m.id);
      expect(ids.sort()).toEqual([...expected.medicineIdsByStatus[status]].sort());
      expect(ids).toHaveLength(expected.statusCounts[status]);
    }
  });

  it('records the replacement of Amlodipine 5 mg, and never stops Atorvastatin by itself', () => {
    const old = state.medicines.find((m) => m.id === M.amlodipine5)!;
    expect(old.status).toBe('stopped');
    expect(old.replacedByMedicineId).toBe(M.amlodipine10);
    expect(state.medicines.find((m) => m.id === M.atorvastatin10)!.status).toBe('needs_confirmation');
  });

  it('writes the same history as the fixtures', () => {
    expect(byId(state.events)).toEqual(byId(sampleEvents));
  });

  it('stores the prescription lines as given', () => {
    expect(byId(state.prescriptionLines)).toEqual(byId(samplePrescriptionLines));
  });

  it('compares the two cardiology prescriptions: added, changed, review, unchanged', () => {
    const diff = buildDiff(state, P.rao);
    expect(diff).toEqual(expected.diff);
    expect(diff!.rows).toEqual(expected.diffRows);
    expect(diff!.rows.map((r) => r.kind)).toEqual(['added', 'changed', 'review', 'unchanged']);
  });

  it('shows the first diabetes prescription as added only, with no previous document', () => {
    const diff = buildDiff(state, P.menon)!;
    expect(diff.previousDocumentId).toBeNull();
    expect(diff.rows.map((r) => r.kind)).toEqual(['added']);
    expect(diff.rows[0].reviewItemId).toBeNull();
  });

  it('adds up paracetamol to 3450 mg a day', () => {
    const totals = ingredientTotals(state.medicines);
    expect(totals).toEqual(expected.ingredientTotals);
    expect(totals[0].perDay).toBe(3450);
    expect(totals[0].parts.map((p) => p.perDay)).toEqual([1950, 1500]);
    expect(totals[0].complete).toBe(true);
  });

  it('has the three open review items, word for word', () => {
    const open = state.reviewItems.filter((r) => r.resolvedAt === null);
    expect(open.map((r) => r.id).sort()).toEqual([...expected.openReviewItemIds].sort());
    expect(byId(state.reviewItems)).toEqual(byId(sampleReviewItems));
  });

  it('opens nothing more when the inbox is refreshed again', () => {
    const ctx = at('2026-11-14T08:00:00+05:30');
    expect(expectedReviewItems(state, ctx)).toEqual([]);
    expect(isEmptyPlan(planReviewRefresh(state, ctx))).toBe(true);
  });

  it('summarises the changes since 28 October', () => {
    expect(buildChangeSummary(state, SAMPLE_TODAY)).toEqual(expected.changeSummary);
  });

  it('keeps the two questions on the visit', () => {
    expect(state.visits).toEqual([sampleVisit]);
    expect(state.visits[0].questions.map((q) => q.text)).toEqual([
      'Does Rosuvastatin replace Atorvastatin, or should he take both?',
      'Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol.',
    ]);
  });

  it('builds the passport for the visit', () => {
    expect(buildPassport(state, SAMPLE_TODAY)).toEqual({
      patientName: 'Ramesh Iyer',
      patientAge: 71,
      preparedBy: 'Anjali Iyer, daughter',
      preparedOn: '2026-11-14',
      visitAt: '2026-11-18T10:30:00+05:30',
      prescriberName: 'Dr. Kavita Rao',
      prescriberSpecialty: 'Cardiology',
      currentMedicines: [
        { productName: 'Amlodipine 10 mg', instruction: '1 tablet, morning', prescriberName: 'Dr. Kavita Rao' },
        { productName: 'Rosuvastatin 10 mg', instruction: '1 tablet, night', prescriberName: 'Dr. Kavita Rao' },
        { productName: 'Telmisartan 40 mg', instruction: '1 tablet, morning', prescriberName: 'Dr. Kavita Rao' },
        { productName: 'Metformin 500 mg', instruction: '1 tablet, twice a day', prescriberName: 'Dr. Suresh Menon' },
      ],
      changesSince: '2026-08-05',
      changes: [
        { kind: 'added', text: 'Rosuvastatin 10 mg, 1 tablet, night (28 Oct)' },
        { kind: 'changed', text: 'Amlodipine from 5 mg to 10 mg, 1 tablet, morning (28 Oct)' },
        { kind: 'unconfirmed', text: 'Atorvastatin 10 mg is not on the 28 Oct prescription' },
      ],
      flags: [
        'Two products at home contain paracetamol: Dolo 650 and Crocin Advance 500. Neither is on a prescription in these records.',
      ],
      documents: [
        { title: 'Lipid profile', documentDate: '2026-11-12' },
        { title: 'ECG report', documentDate: '2026-09-15' },
      ],
      questions: [
        'Does Rosuvastatin replace Atorvastatin, or should he take both?',
        'Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol.',
      ],
    });
  });

  it('changes nothing when a prescription is applied a second time', () => {
    const ctx = at('2026-11-14T08:00:00+05:30');
    const again = planPrescriptionApply(state, P.rao, D.raoLatest, linesFor(D.raoLatest), ctx);
    expect(isEmptyPlan(again)).toBe(true);
    expect(isEmptyPlan(withReviewRefresh(state, again, ctx))).toBe(true);
  });
});
