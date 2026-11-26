// Reading scenarios for the v2 mock. The scenario is chosen from the file name (or type) of the
// stored original, so every reading state can be reached from the UI:
// - 'rx-rao-2026-11-13' or 'demo-prescription': the demo prescription, Aspirin strength read as "7? mg";
// - any image: a pack photo of Dolo 650 (OCR: strength and unit need a look; frequency not on the pack);
//   'blurry' in the name: nothing readable on the device (needsCloud), readable by the cloud reader;
// - 'lipid', 'hba1c', 'thyroid', 'ecg', 'kidney', 'cbc', 'x-ray': reports, dated from the file name;
// - 'locked': a password-protected PDF (locked_pdf);
// - 'pages': a scanned PDF of 5 pages, 2 read;
// - 'mismatch': the patient name on it is someone else's;
// - the seeded sample documents: their stored details and lines, with no field evidence.
import * as T from '../../../contract/types';
import { SAMPLE_DOCUMENT_FILES } from '../../../contract/fixtures/sampleCase';
import type { MockCtx } from './state';
import { applyEvidence } from './routine';
import { patientMatch } from './text';

type Draft = Omit<T.FieldEvidence, 'id' | 'profileId' | 'documentId' | 'reviewedAt' | 'region' | 'page'> & { page?: number };

interface Scenario {
  kind: T.DocumentKind;
  title: string;
  clinicalDate: T.ISODate | null;
  prescriberName: string | null;
  facility: string | null;
  patientNameRead: string | null;
  tags: string[];
  testNames: string[];
  lines: T.ExtractedLine[];
  fields: Draft[];
  engine: T.ExtractionCandidate['engine'];
  pageCount: number | null;
  pagesRead: number | null;
  needsCloud: boolean;
}

export const OTHER_PATIENT = 'Sunita Rao';

const REPORTS: [RegExp, Pick<Scenario, 'kind' | 'title' | 'tags' | 'testNames'>][] = [
  [/lipid/, { kind: 'lab_report', title: 'Lipid profile', tags: ['blood test'], testNames: ['Lipid profile'] }],
  [/hba1c|a1c/, { kind: 'lab_report', title: 'HbA1c report', tags: ['blood test'], testNames: ['HbA1c'] }],
  [/thyroid/, { kind: 'lab_report', title: 'Thyroid profile', tags: ['blood test', 'thyroid'], testNames: ['Thyroid profile'] }],
  [/kidney/, { kind: 'lab_report', title: 'Kidney function test', tags: ['blood test'], testNames: ['Kidney function test'] }],
  [/cbc|blood-count/, { kind: 'lab_report', title: 'Complete blood count', tags: ['blood test'], testNames: ['Complete blood count'] }],
  [/ecg/, { kind: 'test', title: 'ECG report', tags: ['cardiology', 'ecg'], testNames: ['ECG'] }],
  [/x-?ray/, { kind: 'imaging', title: 'Chest X-ray report', tags: ['imaging'], testNames: ['Chest X-ray'] }],
];

const isoFromName = (name: string) => name.match(/(\d{4})-(\d{2})-(\d{2})/)?.[0] ?? null;
const dayFirst = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The file name behind a document, for choosing a scenario. */
export function scenarioName(ctx: MockCtx, doc: T.DocumentRecord): string {
  return (ctx.state.fileNames.get(doc.id) ?? SAMPLE_DOCUMENT_FILES[doc.id] ?? doc.title).toLowerCase();
}

export const isSeeded = (ctx: MockCtx, doc: T.DocumentRecord) =>
  SAMPLE_DOCUMENT_FILES[doc.id] !== undefined && !ctx.state.fileNames.has(doc.id);

const mg = (name: string, strength: number): T.Ingredient[] => [{ name, strength, unit: 'mg' }];

function lineFields(l: T.ExtractedLine, raw: { strength: string; frequency: string }, source: Draft['source']): Draft[] {
  const base = { lineIndex: l.lineIndex, ingredientIndex: null, status: 'extracted' as const, reasons: [], source, confidence: null };
  const i = l.ingredients[0];
  return [
    { ...base, field: 'medicine_name', raw: l.productName, value: l.productName },
    { ...base, field: 'ingredient', ingredientIndex: 0, raw: i.name, value: i.name },
    { ...base, field: 'strength', ingredientIndex: 0, raw: raw.strength, value: String(i.strength) },
    { ...base, field: 'unit', ingredientIndex: 0, raw: i.unit, value: i.unit },
    { ...base, field: 'frequency', raw: raw.frequency, value: l.dosesPerDay === null ? null : String(l.dosesPerDay) },
    { ...base, field: 'instruction', raw: raw.frequency, value: l.instruction },
  ];
}

function docFields(date: T.ISODate | null, patient: string | null, source: Draft['source'], confidence: number | null): Draft[] {
  const base = { lineIndex: null, ingredientIndex: null, status: 'extracted' as const, reasons: [], source, confidence };
  return [
    ...(date ? [{ ...base, field: 'document_date' as const, raw: dayFirst(date), value: date }] : []),
    ...(patient ? [{ ...base, field: 'patient_name' as const, raw: patient, value: patient }] : []),
  ];
}

function demoPrescription(patient: string): Scenario {
  const line = (lineIndex: number, productName: string, ingredients: T.Ingredient[], instruction: string, warnings: string[] = []): T.ExtractedLine =>
    ({ lineIndex, productName, ingredients, form: 'tablet', dosesPerDay: 1, instruction, warnings });
  const lines = [
    line(0, 'Amlodipine 10 mg', mg('amlodipine', 10), '1 tablet, morning'),
    line(1, 'Telmisartan 80 mg', mg('telmisartan', 80), '1 tablet, morning'),
    line(2, 'Rosuvastatin 10 mg', mg('rosuvastatin', 10), '1 tablet, night'),
    // The strength is smudged: the number is unknown until the user checks it.
    line(3, 'Aspirin 7? mg', mg('aspirin', 0), '1 tablet, afternoon', ['Strength could not be read: "7? mg"']),
  ];
  const patterns = ['1-0-0', '1-0-0', '0-0-1', '0-1-0'];
  const fields = lines.flatMap((l, i) => lineFields(l, { strength: `${l.ingredients[0].strength} mg`, frequency: patterns[i] }, 'pdf_text'));
  const aspirinStrength = fields.find((f) => f.lineIndex === 3 && f.field === 'strength')!;
  Object.assign(aspirinStrength, { raw: '7? mg', value: null, status: 'needs_verification', reasons: ['Unclear digit'] });
  return {
    kind: 'prescription', title: 'Cardiology prescription', clinicalDate: '2026-11-13', prescriberName: 'Dr. Kavita Rao',
    facility: 'Sunrise Heart and Diabetes Clinic', patientNameRead: patient, tags: ['cardiology'], testNames: [],
    lines, fields: [...fields, ...docFields('2026-11-13', patient, 'pdf_text', null)],
    engine: 'pdf_text', pageCount: 1, pagesRead: 1, needsCloud: false,
  };
}

function packPhoto(source: 'ocr' | 'cloud'): Scenario {
  const l: T.ExtractedLine = {
    lineIndex: 0, productName: 'Dolo 650', ingredients: mg('paracetamol', 650), form: 'tablet', dosesPerDay: null,
    instruction: '', warnings: ['How often it is taken is not printed on the pack'],
  };
  const look = 'Read from a photo: strengths and units always need a look';
  const base = { lineIndex: 0, status: 'extracted' as const, reasons: [] as string[], source };
  return {
    kind: 'other', title: 'Dolo 650 pack', clinicalDate: null, prescriberName: null, facility: null, patientNameRead: null,
    tags: [], testNames: [], lines: [l],
    fields: [
      { ...base, field: 'medicine_name', ingredientIndex: null, raw: 'DOLO 650', value: 'Dolo 650', confidence: 0.93 },
      { ...base, field: 'ingredient', ingredientIndex: 0, raw: 'Paracetamol', value: 'paracetamol', confidence: 0.9 },
      { ...base, field: 'strength', ingredientIndex: 0, raw: '650 mg', value: '650', confidence: 0.88, status: 'needs_verification', reasons: [look] },
      { ...base, field: 'unit', ingredientIndex: 0, raw: 'mg', value: 'mg', confidence: 0.88, status: 'needs_verification', reasons: [look] },
    ],
    engine: source === 'cloud' ? 'cloud' : 'on_device', pageCount: 1, pagesRead: 1, needsCloud: false,
  };
}

function scenarioFor(ctx: MockCtx, doc: T.DocumentRecord, profileName: string, allowCloud: boolean): Scenario {
  const name = scenarioName(ctx, doc);
  const patient = name.includes('mismatch') ? OTHER_PATIENT : profileName;

  if (name.includes('rx-rao-2026-11-13') || name.includes('demo-prescription')) return demoPrescription(patient);

  if (doc.mimeType.startsWith('image/')) {
    if (name.includes('blurry') && !allowCloud) {
      return {
        kind: 'other', title: doc.title, clinicalDate: null, prescriberName: null, facility: null, patientNameRead: null,
        tags: [], testNames: [], lines: [], fields: [], engine: 'on_device', pageCount: 1, pagesRead: 1, needsCloud: true,
      };
    }
    return packPhoto(name.includes('blurry') ? 'cloud' : 'ocr');
  }

  const date = isoFromName(name);
  const scanned = name.includes('pages') || name.includes('scan');
  const report = REPORTS.find(([re]) => re.test(name))?.[1];
  const source: Draft['source'] = scanned ? 'ocr' : 'pdf_text';
  return {
    kind: report?.kind ?? 'other',
    title: report?.title ?? doc.title,
    clinicalDate: date,
    prescriberName: null,
    facility: report ? 'Lakeside Diagnostics' : null,
    patientNameRead: patient,
    tags: report?.tags ?? [],
    testNames: report?.testNames ?? [],
    lines: [],
    fields: docFields(date, patient, source, scanned ? 0.9 : null),
    engine: scanned ? 'on_device' : 'pdf_text',
    pageCount: name.includes('pages') ? 5 : 1,
    pagesRead: name.includes('pages') ? 2 : 1,
    needsCloud: false,
  };
}

function seededScenario(ctx: MockCtx, doc: T.DocumentRecord): Scenario {
  const lines = ctx.state.lines
    .filter((l) => l.documentId === doc.id)
    .sort((a, b) => a.lineIndex - b.lineIndex)
    .map((l): T.ExtractedLine => ({
      lineIndex: l.lineIndex, productName: l.productName, ingredients: l.ingredients, form: l.form,
      dosesPerDay: l.dosesPerDay, instruction: l.instruction, warnings: [],
    }));
  return {
    kind: doc.kind, title: doc.title, clinicalDate: doc.clinicalDate,
    prescriberName: ctx.state.prescribers.find((p) => p.id === doc.prescriberId)?.name ?? null,
    facility: doc.facility, patientNameRead: doc.patientNameRead, tags: doc.tags, testNames: doc.testNames,
    lines, fields: [], engine: 'pdf_text', pageCount: doc.pageCount, pagesRead: doc.pagesRead, needsCloud: false,
  };
}

const HUMAN_STATUSES: T.FieldStatus[] = ['user_confirmed', 'user_corrected', 'unknown'];
const evidenceKey = (e: Pick<T.FieldEvidence, 'field' | 'lineIndex' | 'ingredientIndex'>) =>
  `${e.field}:${e.lineIndex ?? 'doc'}:${e.ingredientIndex ?? '-'}`;

/**
 * reading.read for the mock. Re-reading keeps every human decision and only refreshes
 * extracted and needs_verification evidence (9.2). The record gets the facts that were read
 * (patient name and match, pages); its kind, title and date are left to the details step.
 */
export function readDocument(ctx: MockCtx, doc: T.DocumentRecord, opts: { allowCloud: boolean; cloudForced: boolean }): T.ExtractionCandidate {
  const { state } = ctx;
  const profileName = state.profiles.find((p) => p.id === doc.profileId)?.name ?? '';
  const s = isSeeded(ctx, doc) ? seededScenario(ctx, doc) : scenarioFor(ctx, doc, profileName, opts.allowCloud);
  const cloud = s.engine === 'cloud' || opts.cloudForced;
  if (cloud) s.engine = 'cloud';

  const kept = state.evidence.filter((e) => e.documentId === doc.id && HUMAN_STATUSES.includes(e.status));
  const keptKeys = new Set(kept.map(evidenceKey));
  const fresh = s.fields
    .filter((f) => !keptKeys.has(evidenceKey(f)))
    .map((f): T.FieldEvidence => ({
      ...f,
      ...(cloud ? { status: 'needs_verification', source: 'cloud', reasons: [...f.reasons, 'Read by the cloud reader: always checked'] } : {}),
      id: `ev-${doc.id}-${evidenceKey(f)}`, profileId: doc.profileId, documentId: doc.id, page: f.page ?? 1, region: null, reviewedAt: null,
    }));
  state.evidence = [...state.evidence.filter((e) => e.documentId !== doc.id), ...kept, ...fresh];
  const fields = state.evidence.filter((e) => e.documentId === doc.id);

  const match = patientMatch(s.patientNameRead, profileName);
  Object.assign(doc, { patientNameRead: s.patientNameRead, patientMatch: match, pageCount: s.pageCount, pagesRead: s.pagesRead });

  const lines = s.lines.map((l) => applyEvidence(l, fields));
  const rawText = [
    s.title, s.prescriberName, s.facility, s.patientNameRead ? `Patient: ${s.patientNameRead}` : null,
    s.clinicalDate ? `Date: ${dayFirst(s.clinicalDate)}` : null,
    ...s.lines.map((l) => `${l.productName} ${l.instruction}`),
  ].filter(Boolean).join('\n');

  return {
    documentId: doc.id, kind: s.kind, title: s.title, clinicalDate: s.clinicalDate, prescriberName: s.prescriberName,
    facility: s.facility, patientNameRead: s.patientNameRead, patientMatch: match, tags: s.tags, testNames: s.testNames,
    lines, fields, engine: s.engine, rawText: s.needsCloud ? '' : rawText, pageCount: s.pageCount, pagesRead: s.pagesRead,
    needsCloud: s.needsCloud,
  };
}

// ---------- Gmail ----------

export interface MockAttachment {
  candidate: Omit<T.GmailCandidate, 'alreadyImported'>;
  patient: 'profile' | typeof OTHER_PATIENT;
}

/** Synthetic inbox: one email with two PDF reports, and one for another person. */
export const GMAIL_ATTACHMENTS: MockAttachment[] = [
  {
    candidate: {
      messageId: 'mock-gmail-lakeside-2026-11-13', attachmentId: 'att-kidney',
      subject: 'Your reports are ready', from: 'reports@lakeside-diagnostics.example',
      receivedAt: '2026-11-13T18:40:00+05:30', attachmentName: 'kidney-function-test-2026-11-13.pdf',
    },
    patient: 'profile',
  },
  {
    candidate: {
      messageId: 'mock-gmail-lakeside-2026-11-13', attachmentId: 'att-cbc',
      subject: 'Your reports are ready', from: 'reports@lakeside-diagnostics.example',
      receivedAt: '2026-11-13T18:40:00+05:30', attachmentName: 'cbc-2026-11-13.pdf',
    },
    patient: 'profile',
  },
  {
    candidate: {
      messageId: 'mock-gmail-riverside-2026-11-02', attachmentId: 'att-xray',
      subject: 'Chest X-ray report', from: 'imaging@riverside-clinic.example',
      receivedAt: '2026-11-02T11:15:00+05:30', attachmentName: 'chest-xray-2026-11-02.pdf',
    },
    patient: OTHER_PATIENT,
  },
];

/** The report details an imported attachment is filed with, as a reading of it would find them. */
export function attachmentDetails(a: MockAttachment, profileName: string) {
  const name = a.candidate.attachmentName.toLowerCase();
  const report = REPORTS.find(([re]) => re.test(name))?.[1];
  const patientNameRead = a.patient === 'profile' ? profileName : a.patient;
  return {
    kind: report?.kind ?? ('other' as T.DocumentKind),
    title: report?.title ?? a.candidate.attachmentName.replace(/\.pdf$/i, ''),
    tags: report?.tags ?? [],
    testNames: report?.testNames ?? [],
    facility: a.candidate.from.includes('lakeside') ? 'Lakeside Diagnostics' : 'Riverside Clinic',
    clinicalDate: isoFromName(name),
    patientNameRead,
    patientMatch: patientMatch(patientNameRead, profileName),
  };
}
