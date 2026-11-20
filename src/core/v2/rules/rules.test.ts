import { describe, expect, it } from 'vitest';
import type { FieldEvidence } from '../../../contract/types';
import { lookupProduct } from '../../drugref/lookup';
import { parsePages, type ParsedDocument, type ParsedLine } from '../reading/parse';
import { classify, findFacility } from './classify';
import { matchPatient, readPatientName, sameName } from './patient';
import {
  applyDecisions,
  applyEvidence,
  buildEvidence,
  CONFIDENCE_THRESHOLD,
  lineVerified,
  mergeEvidence,
  REASONS,
  softReferenceWarning,
  toExtractedLines,
  type EvidenceInput,
  type OcrLineInfo,
} from './verify';

const NOW = '2026-11-14T09:00:00+05:30';
let n = 0;
const ctx = { now: NOW, newId: () => `ev-${(n += 1)}` };

const RX = `Sunrise Heart and Diabetes Clinic
Dr. Kavita Rao MD, DM   Date: 13/11/2026
Patient: Ramesh Iyer  Age: 71 years
Rx
1. Tab. Amlodipine 10 mg 1-0-0 30 days
2. Tab. Aspirin 7? mg 0-1-0 30 days`;

function input(parsed: ParsedDocument, over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    profileId: 'p1', documentId: 'd1', source: 'pdf_text', parsed, ocrLines: [],
    patientNameRead: 'Ramesh Iyer', patientMatch: 'match', ...over,
  };
}
const find = (ev: FieldEvidence[], field: string, lineIndex: number | null = null, ingredientIndex: number | null = null) =>
  ev.find((e) => e.field === field && e.lineIndex === lineIndex && e.ingredientIndex === ingredientIndex)!;

describe('patient', () => {
  it('reads the name after a label, without what follows on the line', () => {
    expect(readPatientName('Patient: Ramesh Iyer  Age: 71 years')).toBe('Ramesh Iyer');
    expect(readPatientName("Patient's Name - Mr. R. Iyer, Male")).toBe('Mr. R. Iyer');
    expect(readPatientName('Name: Lakshmi Iyer Sex: F')).toBe('Lakshmi Iyer');
    expect(readPatientName('Pt. Ramesh Iyer UHID 123')).toBe('Ramesh Iyer');
    expect(readPatientName('Dr. Kavita Rao\nNo patient here')).toBeNull();
    expect(readPatientName('Name: 42')).toBeNull();
  });

  it('matches across case, titles, order and initials, never different first names', () => {
    expect(sameName('ramesh iyer', 'Ramesh Iyer')).toBe(true);
    expect(sameName('Mr. R. Iyer', 'Ramesh Iyer')).toBe(true);
    expect(sameName('Iyer Ramesh', 'Ramesh Iyer')).toBe(true);
    expect(sameName('Ramesh', 'Ramesh Iyer')).toBe(true);
    expect(sameName('Ramesh Iyer', 'R Iyer')).toBe(true);
    expect(sameName('Lakshmi Iyer', 'Ramesh Iyer')).toBe(false);
    expect(sameName('R. K.', 'Ramesh Kumar')).toBe(false);
    expect(sameName('Smt.', 'Ramesh Iyer')).toBe(false);
    expect(sameName('Ramesh Venkat Iyer', 'Ramesh Iyer')).toBe(true);
    expect(matchPatient(null, 'Ramesh Iyer')).toBe('not_found');
    expect(matchPatient('Shri Ramesh Iyer', 'Ramesh Iyer')).toBe('match');
    expect(matchPatient('Lakshmi Iyer', 'Ramesh Iyer')).toBe('mismatch');
  });
});

describe('classify', () => {
  it('prescriptions, with a specialty title', () => {
    expect(classify(RX)).toMatchObject({ kind: 'prescription', title: 'Prescription', facility: 'Sunrise Heart and Diabetes Clinic' });
    expect(classify(`${RX}\nConsultant Cardiologist`)).toMatchObject({ kind: 'prescription', specialty: 'cardiology', tags: ['cardiology'], title: 'Cardiology prescription' });
  });

  it('lab reports, imaging, tests and the rest', () => {
    expect(classify('Lakeside Diagnostics\nLab report: Lipid profile\nTotal cholesterol 186 mg/dL')).toMatchObject({
      kind: 'lab_report', testNames: ['Lipid profile'], tags: ['blood test'], title: 'Lipid profile', facility: 'Lakeside Diagnostics',
    });
    expect(classify('Glycated Haemoglobin (HbA1c) 7.1 %').testNames).toEqual(['HbA1c']);
    expect(classify('CBC and TSH results').testNames).toEqual(['Complete blood count', 'Thyroid profile']);
    expect(classify('MRI brain plain study\nImpression: normal')).toMatchObject({ kind: 'imaging', testNames: ['MRI'], title: 'MRI report' });
    expect(classify('X-Ray chest PA view')).toMatchObject({ kind: 'imaging', testNames: ['X-ray'] });
    expect(classify('USG abdomen')).toMatchObject({ kind: 'imaging', testNames: ['Ultrasound'] });
    expect(classify('ECG report\nSinus rhythm')).toMatchObject({ kind: 'test', testNames: ['ECG'], tags: ['cardiology', 'ecg'] });
    expect(classify('Discharge Summary\nDiagnosis ...')).toMatchObject({ kind: 'discharge_summary', title: 'Discharge summary' });
    expect(classify('Medical Certificate\nfit to resume work')).toMatchObject({ kind: 'certificate', title: 'Medical certificate' });
    expect(classify('OPD summary\nComplaints ...')).toMatchObject({ kind: 'consultation', title: 'Consultation notes' });
    expect(classify('Keep out of reach of children')).toMatchObject({ kind: 'other', title: 'Medical record', tags: [], testNames: [] });
  });

  it('finds the facility on its own line only', () => {
    expect(findFacility('City Hospital\nDr. X')).toBe('City Hospital');
    expect(findFacility('Dr. Asha Clinic is great')).toBeNull();
    expect(findFacility('Patient: at City Hospital')).toBeNull();
    expect(findFacility('Apollo Diagnostics.')).toBe('Apollo Diagnostics');
  });
});

describe('buildEvidence from a text PDF', () => {
  const parsed = parsePages([{ page: 1, text: RX }]);
  const ev = buildEvidence(input(parsed), ctx);

  it('one entry per critical field, document-level and per line', () => {
    expect(ev.filter((e) => e.lineIndex === 0).map((e) => e.field)).toEqual(['medicine_name', 'ingredient', 'strength', 'unit', 'frequency', 'instruction']);
    expect(find(ev, 'document_date')).toMatchObject({ raw: 'Dr. Kavita Rao MD, DM   Date: 13/11/2026', value: '2026-11-13', status: 'extracted' });
    expect(find(ev, 'patient_name')).toMatchObject({ value: 'Ramesh Iyer', status: 'extracted' });
    expect(ev.every((e) => e.source === 'pdf_text' && e.profileId === 'p1' && e.documentId === 'd1' && e.reviewedAt === null)).toBe(true);
  });

  it('a clear line from a text layer is extracted, not flagged', () => {
    expect(find(ev, 'strength', 0, 0)).toMatchObject({ raw: '10 mg', value: '10', status: 'extracted', reasons: [] });
    expect(find(ev, 'unit', 0, 0)).toMatchObject({ raw: 'mg', value: 'mg', status: 'extracted' });
    expect(find(ev, 'frequency', 0)).toMatchObject({ raw: '1-0-0', value: '1', status: 'extracted' });
  });

  it('"7? mg" keeps its literal text, has no value, and needs verification', () => {
    expect(find(ev, 'strength', 1, 0)).toMatchObject({ raw: '7? mg', value: null, status: 'needs_verification', reasons: [REASONS.unclearDigit] });
    expect(find(ev, 'ingredient', 1, 0)).toMatchObject({ value: 'aspirin', status: 'extracted' });
  });
});

describe('buildEvidence: every flag reason', () => {
  it('a missing strength, a missing unit, a reference fill-in', () => {
    const parsed = parsePages([{ page: 1, text: 'Rx\nTab. Aspirin 0-1-0\nTab. Aspirin 75 0-1-0\nTab. Telma 40 1-0-0' }]);
    const ev = buildEvidence(input(parsed), ctx);
    expect(find(ev, 'strength', 0, 0)).toMatchObject({ raw: null, value: null, reasons: [REASONS.missingStrength] });
    expect(find(ev, 'unit', 0, 0)).toMatchObject({ value: null, reasons: [REASONS.missingUnit] });
    expect(find(ev, 'strength', 1, 0)).toMatchObject({ raw: '75', value: null, reasons: [REASONS.missingUnit] });
    expect(find(ev, 'strength', 2, 0)).toMatchObject({ value: '40', reasons: [REASONS.fromReference] });
    expect(find(ev, 'ingredient', 2, 0).reasons).toEqual([REASONS.fromReference]);
  });

  it('a manufacturer-level reference that disagrees flags the strength; a weaker one only warns', () => {
    const combiflam = parsePages([{ page: 1, text: 'COMBIFLAM\nEach tablet contains Ibuprofen IP 400 mg Paracetamol IP 500 mg' }]);
    const ev = buildEvidence(input(combiflam), ctx);
    expect(find(ev, 'strength', 0, 0).reasons).toEqual([REASONS.differsFromReference('Combiflam', '400 mg + 325 mg')]);
    const dolo = parsePages([{ page: 1, text: 'DOLO 650\nEach tablet contains Paracetamol IP 500 mg' }]);
    expect(lookupProduct('Dolo 650')!.entry.evidence).toBe('project');
    expect(find(buildEvidence(input(dolo), ctx), 'strength', 0, 0).status).toBe('extracted');
    expect(toExtractedLines(dolo)[0].warnings.some((w) => w.includes('not confirmed by the maker'))).toBe(true);
    const agreeing = parsePages([{ page: 1, text: 'COMBIFLAM\nEach tablet contains Ibuprofen IP 400 mg Paracetamol IP 325 mg' }]);
    expect(find(buildEvidence(input(agreeing), ctx), 'strength', 0, 0).status).toBe('extracted');
  });

  it('an impossible date and another patient\'s name', () => {
    const parsed = parsePages([{ page: 1, text: 'Lab report: Lipid profile\nDate: 31/02/2026' }]);
    const ev = buildEvidence(input(parsed, { patientNameRead: 'Lakshmi Iyer', patientMatch: 'mismatch' }), ctx);
    expect(find(ev, 'document_date')).toMatchObject({ raw: '31/02/2026', value: null, reasons: [REASONS.notARealDate] });
    expect(find(ev, 'patient_name').reasons).toEqual([REASONS.otherPatient]);
    expect(buildEvidence(input(parsePages([{ page: 1, text: 'Lab report: Lipid profile' }]), { patientNameRead: null }), ctx)).toEqual([]);
  });

  it('cloud values always need a look', () => {
    const parsed = parsePages([{ page: 1, text: RX }]);
    const ev = buildEvidence(input(parsed, { source: 'cloud' }), ctx);
    expect(ev.every((e) => e.status === 'needs_verification' && e.reasons.includes(REASONS.cloud))).toBe(true);
  });

  it('from a photo: strength, unit and frequency always need a look; low confidence flags anything', () => {
    const parsed = parsePages([{ page: 1, text: RX }]);
    const word = (text: string, confidence: number, x: number) => ({ text, confidence, box: { x, y: 10, width: 20, height: 10 } });
    const ocrLines: OcrLineInfo[] = [
      { page: 1, text: '1. Tab. Amlodipine 10 mg 1-0-0 30 days', confidence: 0.95, words: [word('Amlodipine', 0.96, 60), word('10', 0.97, 120), word('mg', 0.95, 145), word('1-0-0', 0.9, 170)] },
      { page: 1, text: '2. Tab. Aspirin 7? mg 0-1-0 30 days', confidence: 0.4, words: [word('Aspirin', 0.7, 60), word('7?', 0.31, 120), word('mg', 0.9, 145)] },
      { page: 1, text: 'Patient: Ramesh Iyer  Age: 71 years', confidence: 0.9, words: [word('Ramesh', 0.92, 80), word('Iyer', 0.91, 140)] },
    ];
    const ev = buildEvidence(input(parsed, { source: 'ocr', ocrLines }), ctx);
    expect(find(ev, 'strength', 0, 0)).toMatchObject({ status: 'needs_verification', reasons: [REASONS.fromPhoto], confidence: 0.95, region: { x: 120, y: 10, width: 45, height: 10 } });
    expect(find(ev, 'frequency', 0)).toMatchObject({ reasons: [REASONS.fromPhoto], confidence: 0.9 });
    // The product name includes its strength, so its lowest word confidence is that of 'mg'.
    expect(find(ev, 'medicine_name', 0)).toMatchObject({ status: 'extracted', confidence: 0.95 });
    expect(find(ev, 'strength', 1, 0)).toMatchObject({ raw: '7? mg', confidence: 0.31, reasons: [REASONS.unclearDigit, REASONS.unclearPhoto] });
    expect(find(ev, 'ingredient', 1, 0)).toMatchObject({ confidence: 0.7, reasons: [REASONS.unclearPhoto] });
    expect(find(ev, 'patient_name')).toMatchObject({ page: 1, confidence: 0.91, status: 'extracted' });
    expect(CONFIDENCE_THRESHOLD).toBe(0.8);
  });
});

describe('buildEvidence: edge cases', () => {
  it('photo lines that match loosely or not at all, and values with nothing printed', () => {
    const parsed = parsePages([{ page: 1, text: 'Rx\nTab. Amlodipine 10 mg 1-0-0\nTab. Aspirin 0-1-0\nTab. Telmisartan 40 mg 0-0-0' }]);
    const ocrLines: OcrLineInfo[] = [
      { page: 1, text: '1. Tab. Amlodipine 10 mg 1-0-0 30 days', confidence: 0.9, words: [] },
      { page: 1, text: 'Tab. Aspirin 0-1-0', confidence: 0.95, words: [{ text: 'Aspirin', confidence: 0.95, box: { x: 1, y: 1, width: 1, height: 1 } }] },
    ];
    const ev = buildEvidence(input(parsed, { source: 'ocr', ocrLines, patientNameRead: 'Ramesh Iyer' }), ctx);
    // Line 0 matched an OCR line that contains it; line 2 matched none.
    expect(find(ev, 'medicine_name', 0).confidence).toBe(0.9);
    expect(find(ev, 'medicine_name', 2)).toMatchObject({ confidence: null, region: null });
    // A missing strength has no raw text, so no words to locate.
    expect(find(ev, 'strength', 1, 0)).toMatchObject({ raw: null, confidence: 0.95, region: null });
    // A dose of 0-0-0 is kept as printed with no number per day.
    expect(find(ev, 'frequency', 2)).toMatchObject({ raw: '0-0-0', value: null });
    // The patient name was not found on any OCR line.
    expect(find(ev, 'patient_name')).toMatchObject({ page: null, confidence: null });
  });

  it('a cloud line with no dose text and an unreadable ingredient name', async () => {
    const { parsedFromCloud } = await import('../reading/read');
    const parsed = parsedFromCloud({
      documentType: 'prescription', documentDate: null, prescriberName: null, rawText: 'x', engine: 'cloud', needsCloud: false,
      lines: [{ productName: 'Something', ingredients: [{ name: '***', strength: 5, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] }],
    });
    const ev = buildEvidence(input(parsed, { source: 'cloud', patientNameRead: null }), ctx);
    expect(find(ev, 'ingredient', 0, 0)).toMatchObject({ raw: '***', value: null, reasons: [REASONS.missingIngredient, REASONS.cloud] });
    expect(find(ev, 'instruction', 0)).toMatchObject({ raw: '1 tablet, morning', value: '1 tablet, morning' });
    expect(toExtractedLines(parsed)[0].ingredients).toEqual([]);
  });
});

describe('decisions, merging and verified lines', () => {
  const parsed = parsePages([{ page: 1, text: RX }]);
  const ev = () => buildEvidence(input(parsed), ctx);

  it('confirm, correct and leave unknown', () => {
    const fields = ev();
    const strength = find(fields, 'strength', 1, 0);
    const date = find(fields, 'document_date');
    const name = find(fields, 'patient_name');
    const next = applyDecisions(fields, [
      { evidenceId: strength.id, action: 'correct', value: ' 75 ' },
      { evidenceId: date.id, action: 'confirm' },
      { evidenceId: name.id, action: 'leave_unknown' },
    ], NOW);
    expect(find(next, 'strength', 1, 0)).toMatchObject({ value: '75', status: 'user_corrected', reviewedAt: NOW, raw: '7? mg' });
    expect(find(next, 'document_date')).toMatchObject({ status: 'user_confirmed', value: '2026-11-13' });
    expect(find(next, 'patient_name')).toMatchObject({ status: 'unknown', value: null });
    expect(() => applyDecisions(fields, [{ evidenceId: strength.id, action: 'correct', value: ' ' }], NOW)).toThrow('A correction needs a value.');
    expect(() => applyDecisions(fields, [{ evidenceId: 'nope', action: 'confirm' }], NOW)).toThrow('Unknown field nope');
  });

  it('a re-read keeps every human decision and refreshes the rest', () => {
    const first = ev();
    const decided = applyDecisions(first, [{ evidenceId: find(first, 'strength', 1, 0).id, action: 'correct', value: '75' }], NOW);
    const fresh = ev();
    const merged = mergeEvidence(decided, fresh);
    expect(find(merged, 'strength', 1, 0)).toMatchObject({ value: '75', status: 'user_corrected' });
    expect(merged.filter((e) => e.field === 'strength' && e.lineIndex === 1)).toHaveLength(1);
    expect(find(merged, 'strength', 0, 0).id).toBe(find(fresh, 'strength', 0, 0).id);
    expect(merged).toHaveLength(fresh.length);
  });

  it('a line is verified only when every field was confirmed or corrected', () => {
    const fields = ev();
    const line1 = fields.filter((e) => e.lineIndex === 1);
    expect(lineVerified(fields, 1)).toBe(false);
    const confirmedAll = applyDecisions(fields, line1.map((e) => (e.field === 'strength' ? { evidenceId: e.id, action: 'correct' as const, value: '75' } : { evidenceId: e.id, action: 'confirm' as const })), NOW);
    expect(lineVerified(confirmedAll, 1)).toBe(true);
    const unknownOne = applyDecisions(confirmedAll, [{ evidenceId: find(confirmedAll, 'unit', 1, 0).id, action: 'leave_unknown' }], NOW);
    expect(lineVerified(unknownOne, 1)).toBe(false);
    expect(lineVerified(fields, 9)).toBe(false);
  });

  it('lines show the corrections: "Aspirin 7? mg" becomes "Aspirin 75 mg"', () => {
    const fields = ev();
    const lines = toExtractedLines(parsed);
    expect(lines[1]).toMatchObject({ lineIndex: 1, productName: 'Aspirin 7? mg', ingredients: [{ name: 'aspirin', strength: 0, unit: 'mg' }] });
    const corrected = applyDecisions(fields, [
      { evidenceId: find(fields, 'strength', 1, 0).id, action: 'correct', value: '75' },
      { evidenceId: find(fields, 'frequency', 1).id, action: 'correct', value: '2' },
      { evidenceId: find(fields, 'instruction', 1).id, action: 'correct', value: '1 tablet, twice a day' },
      { evidenceId: find(fields, 'unit', 1, 0).id, action: 'correct', value: 'not-a-unit' },
    ], NOW);
    expect(applyEvidence(lines, corrected)[1]).toMatchObject({
      productName: 'Aspirin 75 mg', ingredients: [{ name: 'aspirin', strength: 75, unit: 'mg' }], dosesPerDay: 2, instruction: '1 tablet, twice a day',
    });
    // Extracted (not yet reviewed) values never change a line; an unreadable correction is ignored.
    expect(applyEvidence(lines, fields)).toEqual(lines);
    const odd = applyDecisions(fields, [{ evidenceId: find(fields, 'strength', 0, 0).id, action: 'correct', value: 'ten' }], NOW);
    expect(applyEvidence(lines, odd)[0].ingredients[0].strength).toBe(10);
  });

  it('soft reference warning only for weaker entries that disagree', () => {
    const line = (text: string): ParsedLine => parsePages([{ page: 1, text }]).lines[0];
    expect(softReferenceWarning(line('COMBIFLAM\ncontains Ibuprofen IP 400 mg Paracetamol IP 500 mg'))).toBeNull();
    expect(softReferenceWarning(line('DOLO 650\ncontains Paracetamol IP 650 mg'))).toBeNull();
    expect(softReferenceWarning(line('DOLO 650\nstrip of 15'))).toBeNull();
  });
});
