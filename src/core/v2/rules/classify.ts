// Document kind, tags, test names, facility and a suggested title, from the text alone.
// A deterministic keyword dictionary: no model. Every value is a suggestion the user can edit.
import type { DocumentKind } from '../../../contract/types';
import { findDocumentType } from '../../reading/parse';

interface TestEntry {
  name: string;
  patterns: RegExp[];
  kind: DocumentKind;
  tags: string[];
}

export const TESTS: readonly TestEntry[] = [
  { name: 'Complete blood count', patterns: [/\bcbc\b/, /complete blood (?:count|picture)/, /ha?emogram/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'Lipid profile', patterns: [/lipid profile/, /\bcholesterol\b/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'HbA1c', patterns: [/\bhba1c\b/, /glycated ha?emoglobin/, /glycosylated ha?emoglobin/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'Thyroid profile', patterns: [/thyroid (?:profile|function)/, /\btsh\b/, /\bft4\b/, /\bt3\b.*\bt4\b/], kind: 'lab_report', tags: ['blood test', 'thyroid'] },
  { name: 'Liver function test', patterns: [/liver function/, /\blft\b/, /\bsgpt\b/, /\bsgot\b/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'Kidney function test', patterns: [/(?:kidney|renal) function/, /\bkft\b/, /\brft\b/, /serum creatinine/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'Blood sugar', patterns: [/blood (?:sugar|glucose)/, /fasting (?:blood )?(?:sugar|glucose)/, /\b(?:fbs|ppbs|rbs)\b/], kind: 'lab_report', tags: ['blood test'] },
  { name: 'Urine examination', patterns: [/urine (?:routine|examination|analysis)/, /urinalysis/], kind: 'lab_report', tags: ['urine test'] },
  { name: 'X-ray', patterns: [/\bx-?ray\b/, /radiograph/], kind: 'imaging', tags: ['imaging'] },
  { name: 'MRI', patterns: [/\bmri\b/, /magnetic resonance/], kind: 'imaging', tags: ['imaging'] },
  { name: 'CT scan', patterns: [/\bct scan\b/, /computed tomography/, /\bhrct\b/], kind: 'imaging', tags: ['imaging'] },
  { name: 'Ultrasound', patterns: [/ultrasound/, /\busg\b/, /sonograph/], kind: 'imaging', tags: ['imaging'] },
  { name: 'ECG', patterns: [/\becg\b/, /\bekg\b/, /electrocardiogra/], kind: 'test', tags: ['cardiology', 'ecg'] },
  { name: 'Echocardiogram', patterns: [/echocardiogra/, /\b2d echo\b/], kind: 'test', tags: ['cardiology'] },
];

const SPECIALTIES: readonly [RegExp, string][] = [
  [/cardiolog/, 'cardiology'],
  [/diabetolog/, 'diabetology'],
  [/endocrinolog/, 'endocrinology'],
  [/neurolog/, 'neurology'],
  [/orthop(?:a)?edic/, 'orthopaedics'],
  [/nephrolog/, 'nephrology'],
  [/gastroenterolog/, 'gastroenterology'],
  [/pulmonolog|chest physician/, 'pulmonology'],
  [/dermatolog/, 'dermatology'],
  [/ophthalmolog/, 'ophthalmology'],
  [/psychiatr/, 'psychiatry'],
  [/general physician|general medicine|internal medicine/, 'general medicine'],
];

const FACILITY = /^(.{3,80}?\b(?:hospitals?|clinic|diagnostics|laborator(?:y|ies)|labs?|healthcare|medical cent(?:re|er)|nursing home|polyclinic))\b[\s.,:]*$/i;

export interface Classification {
  kind: DocumentKind;
  tags: string[];
  testNames: string[];
  facility: string | null;
  specialty: string | null;
  title: string;
}

export function findFacility(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(FACILITY);
    if (m && !/^(?:dr|patient|name|ref)/i.test(line)) return m[1].trim();
  }
  return null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function classify(text: string): Classification {
  const t = text.toLowerCase();
  const tests = TESTS.filter((test) => test.patterns.some((p) => p.test(t)));
  const testNames = tests.map((test) => test.name);
  const specialty = SPECIALTIES.find(([pattern]) => pattern.test(t))?.[1] ?? null;

  let kind: DocumentKind;
  if (/\bdischarge summary\b/.test(t)) kind = 'discharge_summary';
  else if (/medical certificate|fitness certificate|certificate of (?:fitness|illness)/.test(t)) kind = 'certificate';
  else if (findDocumentType(text) === 'prescription') kind = 'prescription';
  else if (tests.some((test) => test.kind === 'imaging')) kind = 'imaging';
  else if (tests.some((test) => test.kind === 'lab_report')) kind = 'lab_report';
  else if (tests.some((test) => test.kind === 'test')) kind = 'test';
  else if (/consultation (?:note|summary)|opd (?:summary|notes?)|clinical notes?/.test(t)) kind = 'consultation';
  else kind = 'other';

  const tags = [...new Set([...tests.flatMap((test) => test.tags), ...(specialty ? [specialty] : [])])];

  let title: string;
  if (kind === 'prescription') title = specialty ? `${capitalize(specialty)} prescription` : 'Prescription';
  else if (kind === 'discharge_summary') title = 'Discharge summary';
  else if (kind === 'certificate') title = 'Medical certificate';
  else if (kind === 'consultation') title = 'Consultation notes';
  else if (testNames.length) title = kind === 'lab_report' ? testNames[0] : `${testNames[0]} report`;
  else title = 'Medical record';

  return { kind, tags, testNames, facility: findFacility(text), specialty, title };
}
