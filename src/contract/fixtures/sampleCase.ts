// CareVault contract v2: the sample case (docs/specs/00-overview.spec.md, section 10).
// FROZEN after Phase 0. The mock serves this data; the core seeds it and must reproduce
// `expected` in its golden test. All data is synthetic. Ids and timestamps are fixed so tests
// are deterministic. Timestamps use India Standard Time (+05:30).

import type {
  DocumentRecord,
  ExtractedLine,
  FieldEvidence,
  HealthEntry,
  ID,
  IngredientTotal,
  PrescriptionLine,
  Prescriber,
  Profile,
  ProposalRowKind,
  RecordQuery,
  RoutineEvent,
  RoutineMedicine,
  RoutineStatus,
  Visit,
} from '../types';

export const SAMPLE_TODAY = '2026-11-14';

// ---------- ids ----------

export const IDS = {
  ramesh: 'sample-profile-ramesh',
  lakshmi: 'sample-profile-lakshmi',
  prescribers: {
    rao: 'sample-prescriber-rao',
    menon: 'sample-prescriber-menon',
    khan: 'sample-prescriber-khan',
  },
  documents: {
    raoPrevious: 'sample-doc-rx-rao-2026-08-05',
    raoLatest: 'sample-doc-rx-rao-2026-10-28',
    menon: 'sample-doc-rx-menon-2026-07-14',
    lipidProfile: 'sample-doc-lipid-2026-11-12',
    ecg: 'sample-doc-ecg-2026-09-15',
    hba1c: 'sample-doc-hba1c-email',
    lakshmiThyroid: 'sample-doc-lakshmi-thyroid-2026-10-02',
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
  medicines: {
    amlodipine10: 'sample-med-amlodipine-10',
    telmisartan40: 'sample-med-telmisartan-40',
    rosuvastatin10: 'sample-med-rosuvastatin-10',
    metformin500: 'sample-med-metformin-500',
    atorvastatin10: 'sample-med-atorvastatin-10',
    dolo650: 'sample-med-dolo-650',
    crocinAdvance500: 'sample-med-crocin-advance-500',
    amlodipine5: 'sample-med-amlodipine-5',
    pantoprazole40: 'sample-med-pantoprazole-40',
    levothyroxine50: 'sample-med-lakshmi-levothyroxine-50',
  },
  health: {
    sulfaAllergy: 'sample-health-ramesh-sulfa',
    hypertension: 'sample-health-ramesh-bp',
    diabetes: 'sample-health-ramesh-t2d',
    lakshmiNoAllergies: 'sample-health-lakshmi-no-allergies',
  },
  visit: 'sample-visit-rao-2026-11-18',
  questions: {
    rosuvastatinVsAtorvastatin: 'sample-question-rosuvastatin-atorvastatin',
    doloAndCrocin: 'sample-question-dolo-crocin',
  },
} as const;

/** The sample profiles keep their own calendar (src/contract/today.ts). */
export const SAMPLE_PROFILE_IDS = [IDS.ramesh, IDS.lakshmi] as const;

/** The files in public/sample-docs/ behind each sample document. Laptop A keeps these in step. */
export const SAMPLE_DOCUMENT_FILES: Readonly<Record<ID, string>> = {
  [IDS.documents.raoPrevious]: 'rx-rao-2026-08-05.pdf',
  [IDS.documents.raoLatest]: 'rx-rao-2026-10-28.pdf',
  [IDS.documents.menon]: 'rx-menon-2026-07-14.pdf',
  [IDS.documents.lipidProfile]: 'lipid-profile-2026-11-12.pdf',
  [IDS.documents.ecg]: 'ecg-report-2026-09-15.pdf',
  [IDS.documents.hba1c]: 'hba1c-report-2026-11-12.pdf',
  [IDS.documents.lakshmiThyroid]: 'thyroid-profile-lakshmi-2026-10-02.pdf',
};

const P = IDS.prescribers;
const D = IDS.documents;
const L = IDS.lines;
const M = IDS.medicines;

// ---------- profiles and prescribers ----------

export const sampleProfiles: Profile[] = [
  {
    id: IDS.ramesh,
    name: 'Ramesh Iyer',
    relation: 'Father',
    birthYear: 1955,
    caregiverName: 'Anjali Iyer',
    caregiverRelation: 'daughter',
    emergencyContact: 'Anjali Iyer, +91 90000 00000',
    createdAt: '2026-06-01T09:00:00+05:30',
  },
  {
    id: IDS.lakshmi,
    name: 'Lakshmi Iyer',
    relation: 'Mother',
    birthYear: 1958,
    caregiverName: 'Anjali Iyer',
    caregiverRelation: 'daughter',
    emergencyContact: 'Anjali Iyer, +91 90000 00000',
    createdAt: '2026-06-01T09:05:00+05:30',
  },
];

export const samplePrescribers: Prescriber[] = [
  { id: P.rao, profileId: IDS.ramesh, name: 'Dr. Kavita Rao', specialty: 'Cardiology' },
  { id: P.menon, profileId: IDS.ramesh, name: 'Dr. Suresh Menon', specialty: 'Diabetology' },
  { id: P.khan, profileId: IDS.lakshmi, name: 'Dr. Farah Khan', specialty: 'General medicine' },
];

// ---------- documents ----------

// sha256 values are fixed placeholders, unique per document. The core may recompute them
// from the files in public/sample-docs/.
const hash = (digit: string) => digit.repeat(64);

function doc(record: Omit<DocumentRecord, 'pageCount' | 'pagesRead' | 'receivedAt'> &
  Partial<Pick<DocumentRecord, 'pageCount' | 'pagesRead' | 'receivedAt'>>): DocumentRecord {
  return { pageCount: 1, pagesRead: 1, receivedAt: null, ...record };
}

export const sampleDocuments: DocumentRecord[] = [
  doc({
    id: D.raoPrevious, profileId: IDS.ramesh, kind: 'prescription', title: 'Cardiology prescription',
    clinicalDate: '2026-08-05', dateSource: 'document', addedAt: '2026-08-05T12:30:00+05:30',
    source: 'camera', state: 'filed', starred: false, prescriberId: P.rao,
    facility: 'Sunrise Heart and Diabetes Clinic', tags: ['cardiology'], testNames: [],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('5'),
  }),
  doc({
    id: D.raoLatest, profileId: IDS.ramesh, kind: 'prescription', title: 'Cardiology prescription',
    clinicalDate: '2026-10-28', dateSource: 'document', addedAt: '2026-10-28T13:10:00+05:30',
    source: 'camera', state: 'filed', starred: false, prescriberId: P.rao,
    facility: 'Sunrise Heart and Diabetes Clinic', tags: ['cardiology'], testNames: [],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('2'),
  }),
  doc({
    id: D.menon, profileId: IDS.ramesh, kind: 'prescription', title: 'Diabetes prescription',
    clinicalDate: '2026-07-14', dateSource: 'document', addedAt: '2026-07-14T11:15:00+05:30',
    source: 'camera', state: 'filed', starred: false, prescriberId: P.menon,
    facility: 'Sunrise Heart and Diabetes Clinic', tags: ['diabetology'], testNames: [],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('6'),
  }),
  doc({
    id: D.lipidProfile, profileId: IDS.ramesh, kind: 'lab_report', title: 'Lipid profile',
    clinicalDate: '2026-11-12', dateSource: 'document', addedAt: '2026-11-12T18:20:00+05:30',
    source: 'upload', state: 'filed', starred: false, prescriberId: null,
    facility: 'Lakeside Diagnostics', tags: ['blood test'], testNames: ['Lipid profile'],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('1'),
  }),
  doc({
    id: D.ecg, profileId: IDS.ramesh, kind: 'test', title: 'ECG report',
    clinicalDate: '2026-09-15', dateSource: 'document', addedAt: '2026-09-15T17:45:00+05:30',
    source: 'upload', state: 'filed', starred: false, prescriberId: null,
    facility: 'Lakeside Diagnostics', tags: ['cardiology', 'ecg'], testNames: ['ECG'],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('3'),
  }),
  doc({
    // Arrived by email; no date could be read from it. Its receipt time is not a clinical date.
    id: D.hba1c, profileId: IDS.ramesh, kind: 'lab_report', title: 'HbA1c report',
    clinicalDate: null, dateSource: 'unknown', addedAt: '2026-11-12T20:06:00+05:30',
    receivedAt: '2026-11-12T20:05:00+05:30',
    source: 'email', state: 'pending_review', starred: false, prescriberId: null,
    facility: 'Lakeside Diagnostics', tags: ['blood test'], testNames: ['HbA1c'],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('4'),
  }),
  doc({
    id: D.lakshmiThyroid, profileId: IDS.lakshmi, kind: 'lab_report', title: 'Thyroid profile',
    clinicalDate: '2026-10-02', dateSource: 'document', addedAt: '2026-10-02T16:00:00+05:30',
    source: 'upload', state: 'filed', starred: false, prescriberId: null,
    facility: 'Lakeside Diagnostics', tags: ['blood test', 'thyroid'], testNames: ['Thyroid profile'],
    patientNameRead: 'Lakshmi Iyer', patientMatch: 'match', mimeType: 'application/pdf', sha256: hash('7'),
  }),
];

// ---------- prescription lines (all verified) ----------

function line(id: ID, documentId: ID, lineIndex: number, productName: string, name: string, strength: number,
  dosesPerDay: number, instruction: string): PrescriptionLine {
  return {
    id, documentId, lineIndex, productName,
    ingredients: [{ name, strength, unit: 'mg' }],
    form: 'tablet', dosesPerDay, instruction, verified: true,
  };
}

export const samplePrescriptionLines: PrescriptionLine[] = [
  line(L.raoPrevAmlodipine, D.raoPrevious, 0, 'Amlodipine 5 mg', 'amlodipine', 5, 1, '1 tablet, morning'),
  line(L.raoPrevTelmisartan, D.raoPrevious, 1, 'Telmisartan 40 mg', 'telmisartan', 40, 1, '1 tablet, morning'),
  line(L.raoPrevAtorvastatin, D.raoPrevious, 2, 'Atorvastatin 10 mg', 'atorvastatin', 10, 1, '1 tablet, night'),
  line(L.raoLatestAmlodipine, D.raoLatest, 0, 'Amlodipine 10 mg', 'amlodipine', 10, 1, '1 tablet, morning'),
  line(L.raoLatestTelmisartan, D.raoLatest, 1, 'Telmisartan 40 mg', 'telmisartan', 40, 1, '1 tablet, morning'),
  line(L.raoLatestRosuvastatin, D.raoLatest, 2, 'Rosuvastatin 10 mg', 'rosuvastatin', 10, 1, '1 tablet, night'),
  line(L.menonMetformin, D.menon, 0, 'Metformin 500 mg', 'metformin', 500, 2, '1 tablet, twice a day'),
];

/** The seeded documents carry no field evidence: nothing in them waits for verification. */
export const sampleFieldEvidence: FieldEvidence[] = [];

// ---------- the reported routine ----------

type Entry = Omit<RoutineMedicine, 'profileId' | 'form' | 'legacyStatus' | 'legacyReviewPending' | 'replacedByMedicineId'> &
  Partial<Pick<RoutineMedicine, 'profileId' | 'replacedByMedicineId'>>;

function entry(e: Entry): RoutineMedicine {
  return {
    profileId: IDS.ramesh, form: 'tablet', legacyStatus: null, legacyReviewPending: false,
    replacedByMedicineId: null, ...e,
  };
}

const mg = (name: string, strength: number) => [{ name, strength, unit: 'mg' as const }];

export const sampleRoutine: RoutineMedicine[] = [
  entry({
    id: M.amlodipine10, productName: 'Amlodipine 10 mg', ingredients: mg('amlodipine', 10),
    dosesPerDay: 1, instruction: '1 tablet, morning', status: 'taking', source: 'caregiver_reported',
    prescriberId: P.rao, sourceDocumentId: D.raoLatest, lastConfirmedAt: '2026-10-30T09:00:00+05:30',
    createdAt: '2026-10-30T09:00:00+05:30', updatedAt: '2026-10-30T09:00:00+05:30',
  }),
  entry({
    id: M.telmisartan40, productName: 'Telmisartan 40 mg', ingredients: mg('telmisartan', 40),
    dosesPerDay: 1, instruction: '1 tablet, morning', status: 'taking', source: 'caregiver_reported',
    prescriberId: P.rao, sourceDocumentId: D.raoPrevious, lastConfirmedAt: '2026-10-30T09:00:00+05:30',
    createdAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-10-30T09:00:00+05:30',
  }),
  entry({
    id: M.rosuvastatin10, productName: 'Rosuvastatin 10 mg', ingredients: mg('rosuvastatin', 10),
    dosesPerDay: 1, instruction: '1 tablet, night', status: 'taking', source: 'caregiver_reported',
    prescriberId: P.rao, sourceDocumentId: D.raoLatest, lastConfirmedAt: '2026-10-30T09:00:00+05:30',
    createdAt: '2026-10-30T09:00:00+05:30', updatedAt: '2026-10-30T09:00:00+05:30',
  }),
  entry({
    id: M.metformin500, productName: 'Metformin 500 mg', ingredients: mg('metformin', 500),
    dosesPerDay: 2, instruction: '1 tablet, twice a day', status: 'taking', source: 'caregiver_reported',
    prescriberId: P.menon, sourceDocumentId: D.menon, lastConfirmedAt: '2026-07-20T09:00:00+05:30',
    createdAt: '2026-07-20T09:00:00+05:30', updatedAt: '2026-07-20T09:00:00+05:30',
  }),
  entry({
    // Missing from Dr. Rao's 28 Oct prescription; the caregiver chose "ask the doctor".
    id: M.atorvastatin10, productName: 'Atorvastatin 10 mg', ingredients: mg('atorvastatin', 10),
    dosesPerDay: 1, instruction: '1 tablet, night', status: 'uncertain', source: 'caregiver_reported',
    prescriberId: P.rao, sourceDocumentId: D.raoPrevious, lastConfirmedAt: null,
    createdAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-10-30T09:00:00+05:30',
  }),
  entry({
    id: M.dolo650, productName: 'Dolo 650', ingredients: mg('paracetamol', 650),
    dosesPerDay: 3, instruction: '1 tablet, three times a day', status: 'taking', source: 'from_pack',
    prescriberId: null, sourceDocumentId: null, lastConfirmedAt: '2026-11-10T19:00:00+05:30',
    createdAt: '2026-11-10T19:00:00+05:30', updatedAt: '2026-11-10T19:00:00+05:30',
  }),
  entry({
    id: M.crocinAdvance500, productName: 'Crocin Advance 500', ingredients: mg('paracetamol', 500),
    dosesPerDay: 3, instruction: '1 tablet, three times a day', status: 'taking', source: 'from_pack',
    prescriberId: null, sourceDocumentId: null, lastConfirmedAt: '2026-11-10T19:05:00+05:30',
    createdAt: '2026-11-10T19:05:00+05:30', updatedAt: '2026-11-10T19:05:00+05:30',
  }),
  entry({
    id: M.amlodipine5, productName: 'Amlodipine 5 mg', ingredients: mg('amlodipine', 5),
    dosesPerDay: 1, instruction: '1 tablet, morning', status: 'stopped', source: 'caregiver_reported',
    prescriberId: P.rao, sourceDocumentId: D.raoPrevious, replacedByMedicineId: M.amlodipine10,
    lastConfirmedAt: '2026-08-07T10:00:00+05:30',
    createdAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-10-30T09:00:00+05:30',
  }),
  entry({
    id: M.pantoprazole40, productName: 'Pantoprazole 40 mg', ingredients: mg('pantoprazole', 40),
    dosesPerDay: 1, instruction: '1 tablet, before breakfast', status: 'stopped', source: 'caregiver_reported',
    prescriberId: null, sourceDocumentId: null, lastConfirmedAt: '2026-06-01T09:30:00+05:30',
    createdAt: '2026-06-01T09:30:00+05:30', updatedAt: '2026-08-05T19:00:00+05:30',
  }),
  entry({
    id: M.levothyroxine50, profileId: IDS.lakshmi, productName: 'Levothyroxine 50 mcg',
    ingredients: [{ name: 'levothyroxine', strength: 50, unit: 'mcg' }],
    dosesPerDay: 1, instruction: '1 tablet, before breakfast', status: 'taking', source: 'caregiver_reported',
    prescriberId: P.khan, sourceDocumentId: null, lastConfirmedAt: '2026-10-05T09:00:00+05:30',
    createdAt: '2026-10-05T09:00:00+05:30', updatedAt: '2026-10-05T09:00:00+05:30',
  }),
];

const routineById = (id: ID) => {
  const found = sampleRoutine.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown sample routine entry ${id}`);
  return found;
};

/** A routine entry as it was at an earlier moment. */
const asWas = (id: ID, patch: Partial<RoutineMedicine>): RoutineMedicine => ({ ...routineById(id), ...patch });

// ---------- routine history (oldest first) ----------

type EventInput = Pick<RoutineEvent, 'id' | 'medicineId' | 'type' | 'at' | 'detail'> &
  Partial<Pick<RoutineEvent, 'documentId' | 'before' | 'after' | 'profileId'>>;

function event(e: EventInput): RoutineEvent {
  return {
    profileId: IDS.ramesh, documentId: null, proposalId: null, before: null,
    after: routineById(e.medicineId), undoesEventId: null, ...e,
  };
}

export const sampleRoutineEvents: RoutineEvent[] = [
  event({
    id: 'sample-event-pantoprazole-added', medicineId: M.pantoprazole40, type: 'added',
    at: '2026-06-01T09:30:00+05:30', detail: 'Added by Anjali',
    after: asWas(M.pantoprazole40, { status: 'taking', updatedAt: '2026-06-01T09:30:00+05:30' }),
  }),
  event({
    id: 'sample-event-metformin-added', medicineId: M.metformin500, type: 'added',
    at: '2026-07-20T09:00:00+05:30', documentId: D.menon, detail: 'Started, as on the prescription of Dr. Suresh Menon',
  }),
  event({
    id: 'sample-event-pantoprazole-stopped', medicineId: M.pantoprazole40, type: 'stopped',
    at: '2026-08-05T19:00:00+05:30', detail: 'Marked as stopped by Anjali',
    before: asWas(M.pantoprazole40, { status: 'taking', updatedAt: '2026-06-01T09:30:00+05:30' }),
  }),
  event({
    id: 'sample-event-amlodipine5-added', medicineId: M.amlodipine5, type: 'added',
    at: '2026-08-07T10:00:00+05:30', documentId: D.raoPrevious, detail: 'Started, as on the prescription of Dr. Kavita Rao',
    after: asWas(M.amlodipine5, { status: 'taking', replacedByMedicineId: null, updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-telmisartan-added', medicineId: M.telmisartan40, type: 'added',
    at: '2026-08-07T10:00:00+05:30', documentId: D.raoPrevious, detail: 'Started, as on the prescription of Dr. Kavita Rao',
    after: asWas(M.telmisartan40, { lastConfirmedAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-atorvastatin-added', medicineId: M.atorvastatin10, type: 'added',
    at: '2026-08-07T10:00:00+05:30', documentId: D.raoPrevious, detail: 'Started, as on the prescription of Dr. Kavita Rao',
    after: asWas(M.atorvastatin10, { status: 'taking', lastConfirmedAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-amlodipine5-replaced', medicineId: M.amlodipine5, type: 'replaced',
    at: '2026-10-30T09:00:00+05:30', documentId: D.raoLatest, detail: 'Replaced by Amlodipine 10 mg',
    before: asWas(M.amlodipine5, { status: 'taking', replacedByMedicineId: null, updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-amlodipine10-added', medicineId: M.amlodipine10, type: 'changed',
    at: '2026-10-30T09:00:00+05:30', documentId: D.raoLatest, detail: '5 mg to 10 mg',
  }),
  event({
    id: 'sample-event-rosuvastatin-added', medicineId: M.rosuvastatin10, type: 'added',
    at: '2026-10-30T09:00:00+05:30', documentId: D.raoLatest, detail: 'Started, as on the prescription of Dr. Kavita Rao',
  }),
  event({
    id: 'sample-event-telmisartan-confirmed', medicineId: M.telmisartan40, type: 'confirmed',
    at: '2026-10-30T09:00:00+05:30', documentId: D.raoLatest, detail: 'Still taking, confirmed by Anjali',
    before: asWas(M.telmisartan40, { lastConfirmedAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-atorvastatin-uncertain', medicineId: M.atorvastatin10, type: 'marked_uncertain',
    at: '2026-10-30T09:00:00+05:30', documentId: D.raoLatest, detail: 'Not sure; question saved for the doctor',
    before: asWas(M.atorvastatin10, { status: 'taking', lastConfirmedAt: '2026-08-07T10:00:00+05:30', updatedAt: '2026-08-07T10:00:00+05:30' }),
  }),
  event({
    id: 'sample-event-dolo-added', medicineId: M.dolo650, type: 'added',
    at: '2026-11-10T19:00:00+05:30', detail: 'Added from a photo of the pack',
  }),
  event({
    id: 'sample-event-crocin-added', medicineId: M.crocinAdvance500, type: 'added',
    at: '2026-11-10T19:05:00+05:30', detail: 'Added from a photo of the pack',
  }),
  event({
    id: 'sample-event-lakshmi-levothyroxine-added', profileId: IDS.lakshmi, medicineId: M.levothyroxine50,
    type: 'added', at: '2026-10-05T09:00:00+05:30', detail: 'Added by Anjali',
  }),
];

// ---------- allergies and history ----------

export const sampleHealthEntries: HealthEntry[] = [
  {
    id: IDS.health.sulfaAllergy, profileId: IDS.ramesh, kind: 'allergy', text: 'Sulfa drugs: rash',
    noneKnown: false, source: 'caregiver_reported', documentId: null, recordedAt: '2026-06-01T09:10:00+05:30',
  },
  {
    id: IDS.health.hypertension, profileId: IDS.ramesh, kind: 'condition', text: 'High blood pressure',
    noneKnown: false, source: 'caregiver_reported', documentId: null, recordedAt: '2026-06-01T09:12:00+05:30',
  },
  {
    id: IDS.health.diabetes, profileId: IDS.ramesh, kind: 'condition', text: 'Type 2 diabetes',
    noneKnown: false, source: 'caregiver_reported', documentId: null, recordedAt: '2026-06-01T09:12:00+05:30',
  },
  {
    id: IDS.health.lakshmiNoAllergies, profileId: IDS.lakshmi, kind: 'allergy', text: '',
    noneKnown: true, source: 'caregiver_reported', documentId: null, recordedAt: '2026-06-01T09:15:00+05:30',
  },
];

// ---------- next visit ----------

export const sampleVisit: Visit = {
  id: IDS.visit,
  profileId: IDS.ramesh,
  prescriberId: P.rao,
  at: '2026-11-18T10:30:00+05:30',
  questions: [
    {
      id: IDS.questions.rosuvastatinVsAtorvastatin,
      text: 'Does Rosuvastatin replace Atorvastatin, or should he take both?',
      source: 'review', medicineId: M.atorvastatin10, documentId: D.raoLatest,
    },
    {
      id: IDS.questions.doloAndCrocin,
      text: 'Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol.',
      source: 'manual', medicineId: null, documentId: null,
    },
  ],
  sharedDocumentIds: [D.lipidProfile, D.ecg],
};

// ---------- the demo prescription (uploaded during the demo, never seeded) ----------

/** The lines of public/sample-docs/rx-rao-2026-11-13.pdf once every critical field is verified. */
const demoVerifiedLines: ExtractedLine[] = [
  { lineIndex: 0, productName: 'Amlodipine 10 mg', ingredients: mg('amlodipine', 10), form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
  { lineIndex: 1, productName: 'Telmisartan 80 mg', ingredients: mg('telmisartan', 80), form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
  { lineIndex: 2, productName: 'Rosuvastatin 10 mg', ingredients: mg('rosuvastatin', 10), form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', warnings: [] },
  { lineIndex: 3, productName: 'Aspirin 75 mg', ingredients: mg('aspirin', 75), form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, afternoon', warnings: [] },
];

interface ExpectedRow {
  kind: ProposalRowKind;
  /** The prescription line's product name, or null for not_mentioned. */
  lineProductName: string | null;
  /** The routine entry the row is about, or null for new. */
  medicineId: ID | null;
  asked: boolean;
  /** True while the line has a critical field that is not checked yet. */
  blockedByVerification: boolean;
}

// ---------- expected results ----------

const expectedParacetamol: IngredientTotal = {
  ingredient: 'paracetamol',
  unit: 'mg',
  perDay: 3450, // 650 mg x 3 + 500 mg x 3
  parts: [
    { medicineId: M.dolo650, productName: 'Dolo 650', perDay: 1950 },
    { medicineId: M.crocinAdvance500, productName: 'Crocin Advance 500', perDay: 1500 },
  ],
  complete: true,
};

const rameshStatusById: Record<ID, RoutineStatus> = Object.fromEntries(
  sampleRoutine.filter((m) => m.profileId === IDS.ramesh).map((m) => [m.id, m.status]),
);

export const expected = {
  ramesh: {
    routineStatusById: rameshStatusById,
    passport: {
      preparedOn: SAMPLE_TODAY,
      patientAge: 71,
      preparedBy: 'Anjali Iyer, daughter',
      visit: { at: '2026-11-18T10:30:00+05:30', prescriberName: 'Dr. Kavita Rao', specialty: 'Cardiology' },
      // Order: the visit's prescriber first, then other prescribers by name, then entries with
      // no prescriber; alphabetical by product name within each group.
      currentMedicineNames: [
        'Amlodipine 10 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg',
        'Metformin 500 mg',
        'Crocin Advance 500', 'Dolo 650',
      ],
      unconfirmedNames: ['Atorvastatin 10 mg'],
      allergies: { state: 'listed' as const, items: ['Sulfa drugs: rash'] },
      conditions: ['High blood pressure', 'Type 2 diabetes'],
      questions: sampleVisit.questions.map((q) => q.text),
      documentTitles: ['Lipid profile', 'ECG report'],
    },
    ingredientTotals: [expectedParacetamol],
    attentionKinds: ['possible_duplicate_ingredient'] as const,
    // Newest clinical date first; undated records after dated ones.
    documentIdsNewestFirst: [D.lipidProfile, D.raoLatest, D.ecg, D.raoPrevious, D.menon, D.hba1c],
    search: {
      // Typed as RecordQuery so they can be passed straight to records.search.
      latestLipidProfile: { query: { text: 'lipid profile', sort: 'newest', limit: 1 } as RecordQuery, firstId: D.lipidProfile },
      hba1cByTest: { query: { testName: 'HbA1c', sort: 'newest' } as RecordQuery, ids: [D.hba1c] },
      cardiologyPrescriptions: {
        query: { kinds: ['prescription'], prescriberId: P.rao, sort: 'newest' } as RecordQuery,
        ids: [D.raoLatest, D.raoPrevious],
      },
    },
    ask: [
      { question: 'latest lipid profile', kind: 'documents' as const, firstDocumentId: D.lipidProfile },
      { question: 'prescriptions from my cardiologist', kind: 'documents' as const, firstDocumentId: D.raoLatest },
      { question: 'what questions did I save', kind: 'questions' as const, firstDocumentId: null },
    ],
  },

  demoPrescription: {
    file: 'rx-rao-2026-11-13.pdf',
    prescriberId: P.rao,
    clinicalDate: '2026-11-13',
    /** How the Aspirin strength reads before verification. */
    aspirinStrengthAsRead: '7? mg',
    verifiedLines: demoVerifiedLines,
    // Rows in core order: changed, new, not_mentioned, uncertain_match, same.
    /** Right after saving, before the Aspirin strength is checked: Aspirin reads as printed and is blocked. */
    proposalRows: [
      { kind: 'changed', lineProductName: 'Telmisartan 80 mg', medicineId: M.telmisartan40, asked: true, blockedByVerification: false },
      { kind: 'new', lineProductName: 'Aspirin 7? mg', medicineId: null, asked: true, blockedByVerification: true },
      { kind: 'not_mentioned', lineProductName: null, medicineId: M.atorvastatin10, asked: true, blockedByVerification: false },
      { kind: 'same', lineProductName: 'Amlodipine 10 mg', medicineId: M.amlodipine10, asked: false, blockedByVerification: false },
      { kind: 'same', lineProductName: 'Rosuvastatin 10 mg', medicineId: M.rosuvastatin10, asked: false, blockedByVerification: false },
    ] satisfies ExpectedRow[],
    /** After the user corrects the Aspirin strength to 75 mg: the only row that changes is Aspirin's. */
    proposalRowsAfterCheck: [
      { kind: 'changed', lineProductName: 'Telmisartan 80 mg', medicineId: M.telmisartan40, asked: true, blockedByVerification: false },
      { kind: 'new', lineProductName: 'Aspirin 75 mg', medicineId: null, asked: true, blockedByVerification: false },
      { kind: 'not_mentioned', lineProductName: null, medicineId: M.atorvastatin10, asked: true, blockedByVerification: false },
      { kind: 'same', lineProductName: 'Amlodipine 10 mg', medicineId: M.amlodipine10, asked: false, blockedByVerification: false },
      { kind: 'same', lineProductName: 'Rosuvastatin 10 mg', medicineId: M.rosuvastatin10, asked: false, blockedByVerification: false },
    ] satisfies ExpectedRow[],
    passiveNotMentionedCount: 3,
    passiveMedicineIds: [M.metformin500, M.dolo650, M.crocinAdvance500],
    /** Made after the Aspirin strength is corrected to 75 mg. */
    decisions: [
      { lineProductName: 'Telmisartan 80 mg', choice: 'started_new' as const },
      { medicineId: M.atorvastatin10, choice: 'skip' as const },
      { lineProductName: 'Aspirin 75 mg', choice: 'started' as const },
    ],
    afterDecisions: {
      currentMedicineNames: [
        'Amlodipine 10 mg', 'Aspirin 75 mg', 'Rosuvastatin 10 mg', 'Telmisartan 80 mg',
        'Metformin 500 mg',
        'Crocin Advance 500', 'Dolo 650',
      ],
      newlyStopped: [{ medicineId: M.telmisartan40, replacedByProductName: 'Telmisartan 80 mg' }],
      unchangedIds: [M.atorvastatin10, M.metformin500, M.dolo650, M.crocinAdvance500, M.amlodipine10, M.rosuvastatin10],
      atorvastatinStatus: 'uncertain' as const,
    },
  },

  lakshmi: {
    passport: {
      currentMedicineNames: ['Levothyroxine 50 mcg'],
      unconfirmedNames: [] as string[],
      allergies: { state: 'none_known' as const, items: [] as string[] },
      visit: null,
    },
    ingredientTotals: [] as IngredientTotal[],
    attentionKinds: [] as string[],
    documentIdsNewestFirst: [D.lakshmiThyroid],
  },
} as const;

// Everything in one object, convenient for seeding.
export const sampleCase = {
  today: SAMPLE_TODAY,
  profiles: sampleProfiles,
  prescribers: samplePrescribers,
  documents: sampleDocuments,
  prescriptionLines: samplePrescriptionLines,
  fieldEvidence: sampleFieldEvidence,
  routine: sampleRoutine,
  routineEvents: sampleRoutineEvents,
  healthEntries: sampleHealthEntries,
  visits: [sampleVisit],
  expected,
} as const;
