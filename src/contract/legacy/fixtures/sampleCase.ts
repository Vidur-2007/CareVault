// FROZEN after Phase 0. The sample case from overview spec section 10.
// The mock serves this data; the core seeds it and must reproduce `expected` in its golden test.
// All data is synthetic. Ids and timestamps are fixed so tests are deterministic.
// Timestamps use India Standard Time (+05:30), the assumed demo locale.

import type {
  ChangeSummary,
  DocumentRecord,
  IngredientTotal,
  Medicine,
  MedicationEvent,
  MedicineStatus,
  PrescriptionDiff,
  PrescriptionLine,
  Prescriber,
  Profile,
  ReviewItem,
  Visit,
} from '../types';

export const SAMPLE_TODAY = '2026-11-14';

// ---------- ids ----------

export const IDS = {
  profile: 'sample-profile-ramesh',
  prescribers: {
    rao: 'sample-prescriber-rao',
    menon: 'sample-prescriber-menon',
  },
  documents: {
    lipidProfile: 'sample-doc-lipid-2026-11-12',
    raoLatest: 'sample-doc-rx-rao-2026-10-28',
    ecg: 'sample-doc-ecg-2026-09-15',
    hba1c: 'sample-doc-hba1c-2026-11-12',
    raoPrevious: 'sample-doc-rx-rao-2026-08-05',
    menon: 'sample-doc-rx-menon-2026-07-14',
  },
  medicines: {
    amlodipine5: 'sample-med-amlodipine-5',
    amlodipine10: 'sample-med-amlodipine-10',
    telmisartan40: 'sample-med-telmisartan-40',
    atorvastatin10: 'sample-med-atorvastatin-10',
    rosuvastatin10: 'sample-med-rosuvastatin-10',
    metformin500: 'sample-med-metformin-500',
    dolo650: 'sample-med-dolo-650',
    crocinAdvance500: 'sample-med-crocin-advance-500',
    pantoprazole40: 'sample-med-pantoprazole-40',
  },
  lines: {
    raoPrevAmlodipine: 'sample-line-rao-prev-amlodipine',
    raoPrevTelmisartan: 'sample-line-rao-prev-telmisartan',
    raoPrevAtorvastatin: 'sample-line-rao-prev-atorvastatin',
    raoLatestAmlodipine: 'sample-line-rao-latest-amlodipine',
    raoLatestTelmisartan: 'sample-line-rao-latest-telmisartan',
    raoLatestRosuvastatin: 'sample-line-rao-latest-rosuvastatin',
    menonMetformin: 'sample-line-menon-metformin',
  },
  reviewItems: {
    confirmAtorvastatin: 'sample-review-confirm-atorvastatin',
    duplicateParacetamol: 'sample-review-duplicate-paracetamol',
    newDocumentHba1c: 'sample-review-new-document-hba1c',
  },
  visit: 'sample-visit-rao-2026-11-18',
  questions: {
    rosuvastatinVsAtorvastatin: 'sample-question-rosuvastatin-atorvastatin',
    doloAndCrocin: 'sample-question-dolo-crocin',
  },
} as const;

const D = IDS.documents;
const M = IDS.medicines;
const L = IDS.lines;
const R = IDS.reviewItems;
const P = IDS.prescribers;

// ---------- profile and prescribers ----------

export const sampleProfile: Profile = {
  id: IDS.profile,
  name: 'Ramesh Iyer',
  relation: 'Father',
  birthYear: 1955,
  caregiverName: 'Anjali Iyer',
  caregiverRelation: 'daughter',
  createdAt: '2026-06-01T09:00:00+05:30',
};

export const samplePrescribers: Prescriber[] = [
  { id: P.rao, profileId: IDS.profile, name: 'Dr. Kavita Rao', specialty: 'Cardiology' },
  { id: P.menon, profileId: IDS.profile, name: 'Dr. Suresh Menon', specialty: 'Diabetology' },
];

// ---------- documents ----------

// sha256 values are fixed placeholders that are unique per document. The core's seed may
// recompute them from the files in public/sample-docs/.
export const sampleDocuments: DocumentRecord[] = [
  {
    id: D.lipidProfile, profileId: IDS.profile, type: 'lab_report', title: 'Lipid profile',
    documentDate: '2026-11-12', source: 'upload', state: 'confirmed', starred: false,
    prescriberId: null, mimeType: 'application/pdf',
    sha256: '1111111111111111111111111111111111111111111111111111111111111111',
    addedAt: '2026-11-12T18:20:00+05:30',
  },
  {
    id: D.raoLatest, profileId: IDS.profile, type: 'prescription', title: 'Cardiology prescription',
    documentDate: '2026-10-28', source: 'scan', state: 'confirmed', starred: false,
    prescriberId: P.rao, mimeType: 'application/pdf',
    sha256: '2222222222222222222222222222222222222222222222222222222222222222',
    addedAt: '2026-10-28T13:10:00+05:30',
  },
  {
    id: D.ecg, profileId: IDS.profile, type: 'test', title: 'ECG report',
    documentDate: '2026-09-15', source: 'upload', state: 'confirmed', starred: false,
    prescriberId: null, mimeType: 'application/pdf',
    sha256: '3333333333333333333333333333333333333333333333333333333333333333',
    addedAt: '2026-09-15T17:45:00+05:30',
  },
  {
    id: D.hba1c, profileId: IDS.profile, type: 'lab_report', title: 'HbA1c report',
    documentDate: '2026-11-12', source: 'email', state: 'pending_confirmation', starred: false,
    prescriberId: null, mimeType: 'application/pdf',
    sha256: '4444444444444444444444444444444444444444444444444444444444444444',
    addedAt: '2026-11-12T20:05:00+05:30',
  },
  {
    id: D.raoPrevious, profileId: IDS.profile, type: 'prescription', title: 'Cardiology prescription',
    documentDate: '2026-08-05', source: 'scan', state: 'confirmed', starred: false,
    prescriberId: P.rao, mimeType: 'application/pdf',
    sha256: '5555555555555555555555555555555555555555555555555555555555555555',
    addedAt: '2026-08-05T12:30:00+05:30',
  },
  {
    id: D.menon, profileId: IDS.profile, type: 'prescription', title: 'Diabetes prescription',
    documentDate: '2026-07-14', source: 'scan', state: 'confirmed', starred: false,
    prescriberId: P.menon, mimeType: 'application/pdf',
    sha256: '6666666666666666666666666666666666666666666666666666666666666666',
    addedAt: '2026-07-14T11:15:00+05:30',
  },
];

// ---------- prescription lines ----------

export const samplePrescriptionLines: PrescriptionLine[] = [
  // Dr. Kavita Rao, previous, 2026-08-05
  {
    id: L.raoPrevAmlodipine, documentId: D.raoPrevious, productName: 'Amlodipine 5 mg',
    ingredients: [{ name: 'amlodipine', strength: 5, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', fieldState: 'confirmed',
  },
  {
    id: L.raoPrevTelmisartan, documentId: D.raoPrevious, productName: 'Telmisartan 40 mg',
    ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', fieldState: 'confirmed',
  },
  {
    id: L.raoPrevAtorvastatin, documentId: D.raoPrevious, productName: 'Atorvastatin 10 mg',
    ingredients: [{ name: 'atorvastatin', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', fieldState: 'confirmed',
  },
  // Dr. Kavita Rao, latest, 2026-10-28
  {
    id: L.raoLatestAmlodipine, documentId: D.raoLatest, productName: 'Amlodipine 10 mg',
    ingredients: [{ name: 'amlodipine', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', fieldState: 'confirmed',
  },
  {
    id: L.raoLatestTelmisartan, documentId: D.raoLatest, productName: 'Telmisartan 40 mg',
    ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', fieldState: 'confirmed',
  },
  {
    id: L.raoLatestRosuvastatin, documentId: D.raoLatest, productName: 'Rosuvastatin 10 mg',
    ingredients: [{ name: 'rosuvastatin', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', fieldState: 'confirmed',
  },
  // Dr. Suresh Menon, 2026-07-14
  {
    id: L.menonMetformin, documentId: D.menon, productName: 'Metformin 500 mg',
    ingredients: [{ name: 'metformin', strength: 500, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 2, instruction: '1 tablet, twice a day', fieldState: 'confirmed',
  },
];

// ---------- medicines (final expected state) ----------

export const sampleMedicines: Medicine[] = [
  {
    id: M.amlodipine10, profileId: IDS.profile, productName: 'Amlodipine 10 mg',
    ingredients: [{ name: 'amlodipine', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', prescriberId: P.rao,
    status: 'confirmed_current', origin: 'prescription', sourceDocumentId: D.raoLatest,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-10-28T13:15:00+05:30', updatedAt: '2026-10-28T13:15:00+05:30',
  },
  {
    id: M.rosuvastatin10, profileId: IDS.profile, productName: 'Rosuvastatin 10 mg',
    ingredients: [{ name: 'rosuvastatin', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', prescriberId: P.rao,
    status: 'confirmed_current', origin: 'prescription', sourceDocumentId: D.raoLatest,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-10-28T13:15:00+05:30', updatedAt: '2026-10-28T13:15:00+05:30',
  },
  {
    id: M.telmisartan40, profileId: IDS.profile, productName: 'Telmisartan 40 mg',
    ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', prescriberId: P.rao,
    status: 'confirmed_current', origin: 'prescription', sourceDocumentId: D.raoPrevious,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-08-05T12:35:00+05:30', updatedAt: '2026-08-05T12:35:00+05:30',
  },
  {
    id: M.metformin500, profileId: IDS.profile, productName: 'Metformin 500 mg',
    ingredients: [{ name: 'metformin', strength: 500, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 2, instruction: '1 tablet, twice a day', prescriberId: P.menon,
    status: 'confirmed_current', origin: 'prescription', sourceDocumentId: D.menon,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-07-14T11:20:00+05:30', updatedAt: '2026-07-14T11:20:00+05:30',
  },
  {
    id: M.atorvastatin10, profileId: IDS.profile, productName: 'Atorvastatin 10 mg',
    ingredients: [{ name: 'atorvastatin', strength: 10, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', prescriberId: P.rao,
    status: 'needs_confirmation', origin: 'prescription', sourceDocumentId: D.raoPrevious,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-08-05T12:35:00+05:30', updatedAt: '2026-10-28T13:15:00+05:30',
  },
  {
    id: M.dolo650, profileId: IDS.profile, productName: 'Dolo 650',
    ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 3, instruction: '1 tablet, three times a day', prescriberId: null,
    status: 'found_at_home', origin: 'home_scan', sourceDocumentId: null,
    fieldState: 'extracted', replacedByMedicineId: null,
    createdAt: '2026-11-10T19:00:00+05:30', updatedAt: '2026-11-10T19:00:00+05:30',
  },
  {
    id: M.crocinAdvance500, profileId: IDS.profile, productName: 'Crocin Advance 500',
    ingredients: [{ name: 'paracetamol', strength: 500, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 3, instruction: '1 tablet, three times a day', prescriberId: null,
    status: 'found_at_home', origin: 'home_scan', sourceDocumentId: null,
    fieldState: 'extracted', replacedByMedicineId: null,
    createdAt: '2026-11-10T19:05:00+05:30', updatedAt: '2026-11-10T19:05:00+05:30',
  },
  {
    id: M.amlodipine5, profileId: IDS.profile, productName: 'Amlodipine 5 mg',
    ingredients: [{ name: 'amlodipine', strength: 5, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', prescriberId: P.rao,
    status: 'stopped', origin: 'prescription', sourceDocumentId: D.raoPrevious,
    fieldState: 'confirmed', replacedByMedicineId: M.amlodipine10,
    createdAt: '2026-08-05T12:35:00+05:30', updatedAt: '2026-10-28T13:15:00+05:30',
  },
  {
    id: M.pantoprazole40, profileId: IDS.profile, productName: 'Pantoprazole 40 mg',
    ingredients: [{ name: 'pantoprazole', strength: 40, unit: 'mg' }],
    form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, before breakfast', prescriberId: null,
    status: 'stopped', origin: 'manual', sourceDocumentId: null,
    fieldState: 'confirmed', replacedByMedicineId: null,
    createdAt: '2026-06-01T09:30:00+05:30', updatedAt: '2026-08-05T19:00:00+05:30',
  },
];

// ---------- medication events (chronological) ----------

export const sampleEvents: MedicationEvent[] = [
  {
    id: 'sample-event-pantoprazole-added', profileId: IDS.profile, medicineId: M.pantoprazole40,
    type: 'added', at: '2026-06-01T09:30:00+05:30', documentId: null,
    detail: 'Added by hand',
  },
  {
    id: 'sample-event-metformin-added', profileId: IDS.profile, medicineId: M.metformin500,
    type: 'added', at: '2026-07-14T11:20:00+05:30', documentId: D.menon,
    detail: 'Added from the prescription of Dr. Suresh Menon, 14 Jul 2026',
  },
  {
    id: 'sample-event-amlodipine5-added', profileId: IDS.profile, medicineId: M.amlodipine5,
    type: 'added', at: '2026-08-05T12:35:00+05:30', documentId: D.raoPrevious,
    detail: 'Added from the prescription of Dr. Kavita Rao, 5 Aug 2026',
  },
  {
    id: 'sample-event-telmisartan-added', profileId: IDS.profile, medicineId: M.telmisartan40,
    type: 'added', at: '2026-08-05T12:35:00+05:30', documentId: D.raoPrevious,
    detail: 'Added from the prescription of Dr. Kavita Rao, 5 Aug 2026',
  },
  {
    id: 'sample-event-atorvastatin-added', profileId: IDS.profile, medicineId: M.atorvastatin10,
    type: 'added', at: '2026-08-05T12:35:00+05:30', documentId: D.raoPrevious,
    detail: 'Added from the prescription of Dr. Kavita Rao, 5 Aug 2026',
  },
  {
    id: 'sample-event-pantoprazole-stopped', profileId: IDS.profile, medicineId: M.pantoprazole40,
    type: 'marked_stopped', at: '2026-08-05T19:00:00+05:30', documentId: null,
    detail: 'Marked as stopped by the caregiver',
  },
  {
    id: 'sample-event-amlodipine5-replaced', profileId: IDS.profile, medicineId: M.amlodipine5,
    type: 'replaced', at: '2026-10-28T13:15:00+05:30', documentId: D.raoLatest,
    detail: 'Replaced by Amlodipine 10 mg',
  },
  {
    id: 'sample-event-amlodipine10-strength', profileId: IDS.profile, medicineId: M.amlodipine10,
    type: 'strength_changed', at: '2026-10-28T13:15:00+05:30', documentId: D.raoLatest,
    detail: '5 mg to 10 mg',
  },
  {
    id: 'sample-event-rosuvastatin-added', profileId: IDS.profile, medicineId: M.rosuvastatin10,
    type: 'added', at: '2026-10-28T13:15:00+05:30', documentId: D.raoLatest,
    detail: 'Added from the prescription of Dr. Kavita Rao, 28 Oct 2026',
  },
  {
    id: 'sample-event-atorvastatin-flagged', profileId: IDS.profile, medicineId: M.atorvastatin10,
    type: 'flagged_for_review', at: '2026-10-28T13:15:00+05:30', documentId: D.raoLatest,
    detail: 'Not on the prescription of Dr. Kavita Rao, 28 Oct 2026',
  },
  {
    id: 'sample-event-dolo-added', profileId: IDS.profile, medicineId: M.dolo650,
    type: 'added', at: '2026-11-10T19:00:00+05:30', documentId: null,
    detail: 'Found at home (scanned pack)',
  },
  {
    id: 'sample-event-crocin-added', profileId: IDS.profile, medicineId: M.crocinAdvance500,
    type: 'added', at: '2026-11-10T19:05:00+05:30', documentId: null,
    detail: 'Found at home (scanned pack)',
  },
];

// ---------- open review items ----------

export const sampleReviewItems: ReviewItem[] = [
  {
    id: R.confirmAtorvastatin, profileId: IDS.profile, kind: 'confirm_medicine',
    title: 'Is he still taking Atorvastatin 10 mg?',
    body: "It is in the home inventory, but it is missing from Dr. Kavita Rao's prescription of 28 October, which adds Rosuvastatin 10 mg.",
    medicineIds: [M.atorvastatin10], documentId: D.raoLatest,
    createdAt: '2026-10-28T13:15:00+05:30', resolvedAt: null, resolution: null,
  },
  {
    id: R.duplicateParacetamol, profileId: IDS.profile, kind: 'possible_duplicate',
    title: 'Two products at home contain paracetamol',
    body: 'Dolo 650 and Crocin Advance 500 are different brands of the same ingredient. Please check with a pharmacist before both are used on the same day.',
    medicineIds: [M.dolo650, M.crocinAdvance500], documentId: null,
    createdAt: '2026-11-10T19:05:00+05:30', resolvedAt: null, resolution: null,
  },
  {
    id: R.newDocumentHba1c, profileId: IDS.profile, kind: 'new_document',
    title: 'Add this HbA1c report to his records?',
    body: 'A PDF arrived in the connected inbox on Thursday, 12 November. It looks like a lab report for Ramesh Iyer. Nothing is saved until you confirm.',
    medicineIds: [], documentId: D.hba1c,
    createdAt: '2026-11-12T20:05:00+05:30', resolvedAt: null, resolution: null,
  },
];

// ---------- next visit ----------

export const sampleVisit: Visit = {
  id: IDS.visit,
  profileId: IDS.profile,
  prescriberId: P.rao,
  at: '2026-11-18T10:30:00+05:30',
  questions: [
    {
      id: IDS.questions.rosuvastatinVsAtorvastatin,
      text: 'Does Rosuvastatin replace Atorvastatin, or should he take both?',
      source: 'manual',
    },
    {
      id: IDS.questions.doloAndCrocin,
      text: 'Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol.',
      source: 'manual',
    },
  ],
  sharedDocumentIds: [D.lipidProfile, D.ecg],
};

// ---------- expected results ----------

function line(id: string): PrescriptionLine {
  const found = samplePrescriptionLines.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown sample prescription line ${id}`);
  return found;
}

const expectedDiff: PrescriptionDiff = {
  prescriberId: P.rao,
  previousDocumentId: D.raoPrevious,
  latestDocumentId: D.raoLatest,
  // Display order: added, changed, review, unchanged.
  rows: [
    {
      kind: 'added', previous: null, latest: line(L.raoLatestRosuvastatin),
      note: 'New on this prescription', reviewItemId: null,
    },
    {
      kind: 'changed', previous: line(L.raoPrevAmlodipine), latest: line(L.raoLatestAmlodipine),
      note: '5 mg to 10 mg', reviewItemId: null,
    },
    {
      kind: 'review', previous: line(L.raoPrevAtorvastatin), latest: null,
      note: 'CareVault does not assume it was stopped. Please confirm what he is taking.',
      reviewItemId: R.confirmAtorvastatin,
    },
    {
      kind: 'unchanged', previous: line(L.raoPrevTelmisartan), latest: line(L.raoLatestTelmisartan),
      note: '', reviewItemId: null,
    },
  ],
};

const expectedIngredientTotals: IngredientTotal[] = [
  {
    ingredient: 'paracetamol',
    unit: 'mg',
    perDay: 3450, // 650 mg x 3 + 500 mg x 3 = 1950 + 1500
    parts: [
      { medicineId: M.dolo650, productName: 'Dolo 650', perDay: 1950 },
      { medicineId: M.crocinAdvance500, productName: 'Crocin Advance 500', perDay: 1500 },
    ],
    complete: true,
  },
];

const expectedChangeSummary: ChangeSummary = {
  since: '2026-10-28',
  added: 1,
  changed: 1,
  toConfirm: 1,
  newDocuments: 2, // Lipid profile and HbA1c report, both 2026-11-12
};

const expectedStatusCounts: Record<MedicineStatus, number> = {
  confirmed_current: 4,
  needs_confirmation: 1,
  found_at_home: 2,
  stopped: 2,
};

const expectedMedicineIdsByStatus: Record<MedicineStatus, string[]> = {
  confirmed_current: [M.amlodipine10, M.rosuvastatin10, M.telmisartan40, M.metformin500],
  needs_confirmation: [M.atorvastatin10],
  found_at_home: [M.dolo650, M.crocinAdvance500],
  stopped: [M.amlodipine5, M.pantoprazole40],
};

export const expected = {
  diff: expectedDiff,
  diffRows: expectedDiff.rows,
  ingredientTotals: expectedIngredientTotals,
  changeSummary: expectedChangeSummary,
  statusCounts: expectedStatusCounts,
  medicineIdsByStatus: expectedMedicineIdsByStatus,
  openReviewItemIds: [R.confirmAtorvastatin, R.duplicateParacetamol, R.newDocumentHba1c],
} as const;

// Everything in one object, convenient for seeding.
export const sampleCase = {
  today: SAMPLE_TODAY,
  profile: sampleProfile,
  prescribers: samplePrescribers,
  medicines: sampleMedicines,
  events: sampleEvents,
  documents: sampleDocuments,
  prescriptionLines: samplePrescriptionLines,
  reviewItems: sampleReviewItems,
  visit: sampleVisit,
  expected,
} as const;
