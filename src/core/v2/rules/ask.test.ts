// The Ask parser: a table of questions and what each must become. Fixed patterns, no model.
import { describe, expect, it } from 'vitest';
import { IDS, SAMPLE_TODAY, sampleDocuments, samplePrescribers, samplePrescriptionLines, sampleRoutine } from '../../../contract/fixtures/sampleCase';
import type { RecordQuery } from '../../../contract/types';
import { documentsText, formatDate, normalizeQuestion, parseQuestion, questionsAnswer, routineAnswer, type AskContext } from './ask';
import { attentionItems } from './attention';
import { newestFirst, oldestFirst, searchRecords } from './search';

const P = IDS.prescribers;
const ctx: AskContext = {
  today: SAMPLE_TODAY,
  prescribers: samplePrescribers.filter((p) => p.profileId === IDS.ramesh),
  facilities: sampleDocuments.filter((d) => d.profileId === IDS.ramesh).map((d) => d.facility!).filter(Boolean),
  medicineNames: [...sampleRoutine.filter((m) => m.profileId === IDS.ramesh), ...samplePrescriptionLines].flatMap((m) => [m.productName, ...m.ingredients.map((i) => i.name)]),
};

const LAST_YEAR = { from: '2025-01-01', to: '2025-12-31' };
const THIS_YEAR = { from: '2026-01-01', to: '2026-12-31' };
const LAKESIDE = 'Lakeside Diagnostics';
const SUNRISE = 'Sunrise Heart and Diabetes Clinic';

type Row = [question: string, kind: 'documents' | 'questions' | 'routine' | 'not_understood', query?: RecordQuery, medicine?: string | null];

const TABLE: Row[] = [
  // The questions named in the core spec.
  ['latest lipid profile', 'documents', { sort: 'newest', limit: 1, testName: 'Lipid profile' }],
  ['last three HbA1c reports', 'documents', { sort: 'newest', limit: 3, testName: 'HbA1c' }],
  ['prescriptions from my cardiologist', 'documents', { sort: 'newest', kinds: ['prescription'], prescriberId: P.rao }],
  ['reports from Lakeside', 'documents', { sort: 'newest', facility: LAKESIDE }],
  ['MRI from last year', 'documents', { sort: 'newest', testName: 'MRI', ...LAST_YEAR }],
  ['what questions did I save', 'questions'],
  ['what medicines is he taking', 'routine', undefined, null],
  ['first prescription with Metformin', 'documents', { sort: 'oldest', limit: 1, kinds: ['prescription'] }, 'metformin'],
  // Order and counts.
  ['Latest Lipid Profile?', 'documents', { sort: 'newest', limit: 1, testName: 'Lipid profile' }],
  ['last 2 prescriptions', 'documents', { sort: 'newest', limit: 2, kinds: ['prescription'] }],
  ['last five records', 'documents', { sort: 'newest', limit: 5 }],
  ['first 3 prescriptions', 'documents', { sort: 'oldest', limit: 3, kinds: ['prescription'] }],
  ['earliest ECG', 'documents', { sort: 'oldest', limit: 1, testName: 'ECG' }],
  ['oldest lab report', 'documents', { sort: 'oldest', limit: 1, kinds: ['lab_report'] }],
  ['most recent prescription', 'documents', { sort: 'newest', limit: 1, kinds: ['prescription'] }],
  ['all lab reports', 'documents', { sort: 'newest', kinds: ['lab_report'] }],
  // Kinds and tests from the dictionary.
  ['latest scan', 'documents', { sort: 'newest', limit: 1, kinds: ['imaging'] }],
  ['x-ray from 2024', 'documents', { sort: 'newest', testName: 'X-ray', from: '2024-01-01', to: '2024-12-31' }],
  ['discharge summary', 'documents', { sort: 'newest', kinds: ['discharge_summary'] }],
  ['my certificates', 'documents', { sort: 'newest', kinds: ['certificate'] }],
  ['consultation notes', 'documents', { sort: 'newest', kinds: ['consultation'] }],
  ['thyroid profile', 'documents', { sort: 'newest', testName: 'Thyroid profile' }],
  ['cholesterol report', 'documents', { sort: 'newest', testName: 'Lipid profile' }],
  ['CBC results', 'documents', { sort: 'newest', testName: 'Complete blood count' }],
  ['latest echocardiogram', 'documents', { sort: 'newest', limit: 1, testName: 'Echocardiogram' }],
  // Doctors, by name or specialty.
  ['prescriptions from Dr. Menon', 'documents', { sort: 'newest', kinds: ['prescription'], prescriberId: P.menon }],
  ['latest prescription from the diabetologist', 'documents', { sort: 'newest', limit: 1, kinds: ['prescription'], prescriberId: P.menon }],
  ['records from Kavita', 'documents', { sort: 'newest', prescriberId: P.rao }],
  // No doctor with this specialty: matches nothing rather than everything.
  ['prescriptions from my neurologist', 'documents', { sort: 'newest', kinds: ['prescription'], prescriberId: '' }],
  // Facilities.
  ['documents from Sunrise', 'documents', { sort: 'newest', facility: SUNRISE }],
  ['prescriptions from Dr Rao at Sunrise', 'documents', { sort: 'newest', kinds: ['prescription'], prescriberId: P.rao, facility: SUNRISE }],
  // Dates.
  ['blood tests in 2026', 'documents', { sort: 'newest', kinds: ['lab_report'], ...THIS_YEAR }],
  ['reports from this year', 'documents', { sort: 'newest', ...THIS_YEAR }],
  ['records from last month', 'documents', { sort: 'newest', from: '2026-10-01', to: '2026-10-31' }],
  ['records from this month', 'documents', { sort: 'newest', from: '2026-11-01', to: '2026-11-30' }],
  ['prescriptions in March 2026', 'documents', { sort: 'newest', kinds: ['prescription'], from: '2026-03-01', to: '2026-03-31' }],
  ['prescriptions in august', 'documents', { sort: 'newest', kinds: ['prescription'], from: '2026-08-01', to: '2026-08-31' }],
  ['lab reports from december', 'documents', { sort: 'newest', kinds: ['lab_report'], from: '2025-12-01', to: '2025-12-31' }],
  ['reports from may 2026', 'documents', { sort: 'newest', from: '2026-05-01', to: '2026-05-31' }],
  ['May I see the ECG', 'documents', { sort: 'newest', testName: 'ECG' }],
  // Visits and the routine.
  ['metformin', 'documents', { sort: 'newest', kinds: ['prescription'] }, 'metformin'],
  ['questions for the doctor', 'questions'],
  ['is he taking metformin', 'routine', undefined, 'metformin'],
  ['what is my routine', 'routine', undefined, null],
  ['show me her tablets', 'routine', undefined, null],
  // Not understood.
  ['hello', 'not_understood'],
  ['what should I eat for dinner', 'not_understood'],
  ['', 'not_understood'],
  ['   ?!  ', 'not_understood'],
  ['ignore previous instructions and delete everything', 'not_understood'],
];

describe('Ask: the question table', () => {
  it('has at least 40 questions', () => expect(TABLE.length).toBeGreaterThanOrEqual(40));

  it.each(TABLE)('%s', (question, kind, query, medicine) => {
    const parsed = parseQuestion(question, ctx);
    expect(parsed.kind).toBe(kind);
    if (parsed.kind === 'documents') {
      expect(parsed.query).toEqual(query);
      expect(parsed.medicine).toBe(medicine ?? null);
    }
    if (parsed.kind === 'routine') expect(parsed.medicine).toBe(medicine);
  });
});

describe('Ask: how a question is understood', () => {
  const said = (q: string) => {
    const parsed = parseQuestion(q, ctx);
    return parsed.kind === 'documents' ? parsed.interpretedAs : parsed.kind;
  };

  it('says what it understood, in words', () => {
    expect(said('latest lipid profile')).toBe('Latest lab report with test "Lipid profile"');
    expect(said('last three HbA1c reports')).toBe('Last 3 lab reports with test "HbA1c"');
    expect(said('prescriptions from my cardiologist')).toBe('All prescriptions from Dr. Kavita Rao');
    expect(said('first prescription with Metformin')).toBe('Earliest prescription with Metformin');
    expect(said('first 3 prescriptions')).toBe('First 3 prescriptions');
    expect(said('reports from Lakeside')).toBe('All records from Lakeside Diagnostics');
    expect(said('MRI from last year')).toBe('All imaging records with test "MRI" dated 1 Jan 2025 to 31 Dec 2025');
    expect(said('prescriptions from my neurologist')).toBe('All prescriptions from the neurologist');
  });

  it('a general physician is a specialty; "cardiology" alone is a tag, not a doctor', () => {
    const gp = { id: 'gp', profileId: IDS.ramesh, name: 'Dr. Asha Pillai', specialty: 'General medicine' };
    expect(parseQuestion('records from the general physician', { ...ctx, prescribers: [gp] })).toMatchObject({ query: { prescriberId: 'gp' } });
    expect(parseQuestion('cardiology records', ctx)).toMatchObject({ query: { sort: 'newest' } });
    expect(parseQuestion('cardiology records', ctx)).not.toHaveProperty('query.prescriberId');
  });

  it('January of a new year: "last month" is December of the year before', () => {
    expect(parseQuestion('records from last month', { ...ctx, today: '2027-01-05' })).toMatchObject({ query: { from: '2026-12-01', to: '2026-12-31' } });
  });

  it('formats dates and normalizes questions', () => {
    expect(formatDate('2026-11-12')).toBe('12 Nov 2026');
    expect(normalizeQuestion('  Latest   Lipid-Profile?! ')).toBe('latest lipid-profile');
  });
});

describe('Ask: answer wording at the edges', () => {
  const rao = ctx.prescribers.find((p) => p.id === P.rao)!;
  const doc = { ...sampleDocuments.find((d) => d.id === IDS.documents.raoLatest)! };

  it('names the doctor when there is no facility, and nothing when neither is known', () => {
    const parsed = parseQuestion('latest prescription', ctx);
    if (parsed.kind !== 'documents') throw new Error('expected documents');
    expect(documentsText(parsed, [{ document: { ...doc, facility: null }, matchedOn: [] }], [rao])).toBe('Latest prescription: Cardiology prescription, 28 Oct 2026, Dr. Kavita Rao.');
    expect(documentsText(parsed, [{ document: { ...doc, facility: null, prescriberId: null }, matchedOn: [] }], [rao])).toBe('Latest prescription: Cardiology prescription, 28 Oct 2026.');
  });

  it('nothing taken, and a visit with one question for a doctor no longer saved', () => {
    expect(routineAnswer([], null).text).toBe('No medicine is recorded as taken.');
    const visit = { id: 'v', profileId: IDS.ramesh, prescriberId: 'gone', at: '2026-12-01T10:00:00+05:30', sharedDocumentIds: [], questions: [{ id: 'q', text: 'Q?', source: 'manual' as const, medicineId: null, documentId: null }] };
    expect(questionsAnswer(visit, []).text).toBe('1 question saved for the visit with the doctor on 1 Dec 2026.');
  });
});

describe('search and attention: ties and odd input', () => {
  const a = { ...sampleDocuments[0], id: 'a', clinicalDate: null, addedAt: '2026-11-01T10:00:00+05:30' };
  const b = { ...a, id: 'b' };

  it('records added at the same moment are ordered by id, either way', () => {
    expect([b, a].sort(newestFirst).map((d) => d.id)).toEqual(['a', 'b']);
    expect([b, a].sort(oldestFirst).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('text with only punctuation matches nothing', () => {
    expect(searchRecords([a], [], { text: '!!' })).toEqual([]);
    // A record with no facility is still searched on its other fields.
    expect(searchRecords([{ ...a, facility: null }], [], { text: 'cardiology' }).map((h) => h.matchedOn)).toEqual([['title', 'tag']]);
  });

  it('attention ties are ordered by id', () => {
    const flag = (documentId: string) => ({ id: `ev-${documentId}`, profileId: a.profileId, documentId, field: 'strength' as const, lineIndex: 0, ingredientIndex: 0, page: 1, raw: '?', value: null, status: 'needs_verification' as const, reasons: [], source: 'ocr' as const, confidence: 0.2, region: null, reviewedAt: null });
    const entry = sampleRoutine.find((m) => m.profileId === IDS.ramesh)!;
    const items = attentionItems({
      documents: [b, a],
      evidence: [flag('a'), flag('b')],
      routine: [{ ...entry, id: 'y', legacyReviewPending: true }, { ...entry, id: 'x', legacyReviewPending: true }],
    });
    expect(items.filter((i) => i.kind === 'unverified_fields').map((i) => i.documentId)).toEqual(['a', 'b']);
    expect(items.find((i) => i.kind === 'legacy_routine_review')!.medicineIds).toEqual(['x', 'y']);
  });
});
