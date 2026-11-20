// "Ask" (overview 9.8): a question in plain English, parsed by fixed patterns into a records
// query. No language model, no instructions: the question and every record's text are data.
// Answers are short and factual, never advice, and say "in CareVault" rather than "ever".
import type {
  DocumentKind,
  DocumentRecord,
  ISODate,
  Prescriber,
  Question,
  RecordHit,
  RecordQuery,
  RoutineMedicine,
  Visit,
} from '../../../contract/types';
import { SPECIALTIES, TESTS } from './classify';

export interface AskContext {
  today: ISODate;
  prescribers: readonly Prescriber[];
  /** Facility names on this profile's records. */
  facilities: readonly string[];
  /** Medicine names known for this profile: ingredients and product names. */
  medicineNames: readonly string[];
}

export type ParsedQuestion =
  | { kind: 'not_understood' }
  | { kind: 'questions' }
  | { kind: 'routine'; medicine: string | null }
  | { kind: 'documents'; query: RecordQuery; medicine: string | null; interpretedAs: string; nouns: readonly [string, string] };

export const HINT =
  'Try "latest lipid profile", "prescriptions from Dr. Rao", "reports from last year", "what questions did I save" or "what medicines are taken".';

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUMBER = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
const toNumber = (word: string) => NUMBERS[word] ?? Number(word);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const KINDS: readonly [RegExp, DocumentKind][] = [
  [/\bprescriptions?\b|\brx\b/, 'prescription'],
  [/\blab (?:reports?|results?|tests?)\b|\bblood (?:tests?|reports?)\b|\blabs?\b/, 'lab_report'],
  [/\bdischarge (?:summary|summaries|papers?)\b/, 'discharge_summary'],
  [/\b(?:scans?|imaging)\b/, 'imaging'],
  [/\bconsultations?\b|\bconsult notes?\b/, 'consultation'],
  [/\bcertificates?\b/, 'certificate'],
];

const KIND_NOUN: Record<DocumentKind, [string, string]> = {
  prescription: ['prescription', 'prescriptions'],
  lab_report: ['lab report', 'lab reports'],
  imaging: ['imaging record', 'imaging records'],
  test: ['test', 'tests'],
  discharge_summary: ['discharge summary', 'discharge summaries'],
  consultation: ['consultation', 'consultations'],
  certificate: ['certificate', 'certificates'],
  other: ['record', 'records'],
};

const GENERIC = /\b(?:records?|documents?|files?|reports?|results?|papers?|tests?)\b/;
const ROUTINE = /\b(?:medicines?|medications?|meds|routine|tablets?|pills?)\b|\btaking\b/;
/** Words that say nothing about which facility is meant. */
const FACILITY_FILLER = new Set(['the', 'and', 'of', 'clinic', 'hospital', 'hospitals', 'diagnostics', 'diagnostic', 'centre', 'center', 'labs', 'lab', 'medical', 'health', 'care', 'heart', 'diabetes', 'laboratory']);

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthRange = (year: number, month: number) => ({ from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}` });
const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-12' → '12 Nov 2026'. */
export function formatDate(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const hasWord = (text: string, word: string) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);

/** Text as the patterns see it: lowercase, punctuation as spaces. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findDates(text: string, today: ISODate): { range: { from: ISODate; to: ISODate } | null; rest: string } {
  const [ty, tm] = today.split('-').map(Number);
  let match: RegExpMatchArray | null;
  if ((match = text.match(/\blast year\b/))) return { range: yearRange(ty - 1), rest: text.replace(match[0], ' ') };
  if ((match = text.match(/\bthis year\b/))) return { range: yearRange(ty), rest: text.replace(match[0], ' ') };
  if ((match = text.match(/\blast month\b/))) {
    const [y, m] = tm === 1 ? [ty - 1, 12] : [ty, tm - 1];
    return { range: monthRange(y, m), rest: text.replace(match[0], ' ') };
  }
  if ((match = text.match(/\bthis month\b/))) return { range: monthRange(ty, tm), rest: text.replace(match[0], ' ') };
  if ((match = text.match(new RegExp(`\\b(?:in |from |of )?${MONTH}(?: (\\d{4}))?\\b`)))) {
    const explicitYear = match[2] !== undefined;
    // A bare "may" is a verb as often as a month: only "in May" or "May 2026" count.
    if (explicitYear || /^(?:in|from|of) /.test(match[0])) {
      const month = MONTHS.indexOf(match[1].slice(0, 3)) + 1;
      const year = explicitYear ? Number(match[2]) : month <= tm ? ty : ty - 1;
      return { range: monthRange(year, month), rest: text.replace(match[0], ' ') };
    }
  }
  if ((match = text.match(/\b(?:in |from |of )?((?:19|20)\d{2})\b/))) return { range: yearRange(Number(match[1])), rest: text.replace(match[0], ' ') };
  return { range: null, rest: text };
}

function findOrder(text: string): Pick<RecordQuery, 'sort' | 'limit'> | null {
  let match: RegExpMatchArray | null;
  if ((match = text.match(new RegExp(`\\b(?:latest|last|most recent|recent|newest) ${NUMBER}\\b`)))) return { sort: 'newest', limit: toNumber(match[1]) };
  if ((match = text.match(new RegExp(`\\b(?:first|earliest|oldest) ${NUMBER}\\b`)))) return { sort: 'oldest', limit: toNumber(match[1]) };
  if (/\b(?:latest|last|most recent|newest)\b/.test(text)) return { sort: 'newest', limit: 1 };
  if (/\b(?:first|earliest|oldest)\b/.test(text)) return { sort: 'oldest', limit: 1 };
  return null;
}

function findDoctor(text: string, prescribers: readonly Prescriber[]): { prescriber: Prescriber | null; label: string } | null {
  for (const prescriber of [...prescribers].sort((a, b) => a.name.localeCompare(b.name))) {
    const names = normalizeQuestion(prescriber.name).split(' ').filter((w) => w.length >= 3 && w !== 'doctor');
    if (names.some((w) => hasWord(text, w))) return { prescriber, label: prescriber.name };
  }
  // A doctor named by specialty: "my cardiologist". The specialty alone ("cardiology") is a tag, not a doctor.
  const doctorWords = text.split(' ').filter((w) => /(?:ists?|ians?|p(?:a)?edics?)$/.test(w));
  if (/\bgeneral physician\b/.test(text)) doctorWords.push('general physician');
  for (const word of doctorWords) {
    const specialty = SPECIALTIES.find(([pattern]) => pattern.test(word))?.[1];
    if (!specialty) continue;
    const prescriber = [...prescribers].sort((a, b) => a.name.localeCompare(b.name)).find((p) => p.specialty.toLowerCase() === specialty) ?? null;
    return { prescriber, label: prescriber ? prescriber.name : `the ${word.replace(/s$/, '')}` };
  }
  return null;
}

function findFacility(text: string, facilities: readonly string[]): string | null {
  for (const facility of [...new Set(facilities)].sort()) {
    const words = normalizeQuestion(facility).split(' ').filter((w) => w.length >= 4 && !FACILITY_FILLER.has(w));
    if (words.some((w) => hasWord(text, w))) return facility;
  }
  return null;
}

function findMedicine(text: string, names: readonly string[]): string | null {
  const candidates = [...new Set(names.map((n) => normalizeQuestion(n).split(' ')[0]).filter((n) => n.length >= 4))].sort();
  return candidates.find((name) => hasWord(text, name)) ?? null;
}

export function parseQuestion(question: string, ctx: AskContext): ParsedQuestion {
  const text = normalizeQuestion(question);
  if (!text) return { kind: 'not_understood' };
  if (/\bquestions?\b/.test(text)) return { kind: 'questions' };

  const kindMatch = KINDS.find(([pattern]) => pattern.test(text));
  const medicine = findMedicine(text, ctx.medicineNames);
  if (ROUTINE.test(text) && !kindMatch) return { kind: 'routine', medicine };

  const { range, rest } = findDates(text, ctx.today);
  const order = findOrder(rest);
  const test = TESTS.find((t) => t.patterns.some((p) => p.test(rest)));
  const doctor = findDoctor(rest, ctx.prescribers);
  const facility = findFacility(rest, ctx.facilities);
  const kinds: DocumentKind[] = kindMatch ? [kindMatch[1]] : medicine ? ['prescription'] : [];

  const understood = kinds.length > 0 || test || doctor || facility || range || GENERIC.test(rest);
  if (!understood) return { kind: 'not_understood' };

  const query: RecordQuery = { sort: order?.sort ?? 'newest' };
  if (order) query.limit = order.limit;
  if (kinds.length > 0) query.kinds = kinds;
  if (test) query.testName = test.name;
  // A specialty with no doctor saved for it matches nothing, rather than everything.
  if (doctor) query.prescriberId = doctor.prescriber?.id ?? '';
  if (facility) query.facility = facility;
  if (range) Object.assign(query, range);

  const one = query.limit === 1;
  const nounKind = kinds[0] ?? test?.kind ?? 'other';
  const noun = KIND_NOUN[nounKind][one ? 0 : 1];
  const lead = !order ? 'All' : one ? (order.sort === 'newest' ? 'Latest' : 'Earliest') : `${order.sort === 'newest' ? 'Last' : 'First'} ${order.limit}`;
  const parts = [`${lead} ${noun}`];
  if (test) parts.push(`with test "${test.name}"`);
  if (medicine) parts.push(`with ${capitalize(medicine)}`);
  if (doctor) parts.push(`from ${doctor.label}`);
  if (facility) parts.push(`from ${facility}`);
  if (range) parts.push(`dated ${formatDate(range.from)} to ${formatDate(range.to)}`);
  return { kind: 'documents', query, medicine, interpretedAs: parts.join(' '), nouns: KIND_NOUN[nounKind] };
}

function describe(doc: DocumentRecord, prescribers: readonly Prescriber[]): string {
  const where = doc.facility ?? prescribers.find((p) => p.id === doc.prescriberId)?.name ?? null;
  return [doc.title, doc.clinicalDate ? formatDate(doc.clinicalDate) : 'no date on it', where].filter(Boolean).join(', ');
}

export function documentsText(parsed: Extract<ParsedQuestion, { kind: 'documents' }>, hits: readonly RecordHit[], prescribers: readonly Prescriber[]): string {
  if (hits.length === 0) return 'No matching records in CareVault.';
  const { sort, limit } = parsed.query;
  if (sort === 'oldest' && limit === 1) return `Earliest in CareVault: ${describe(hits[0].document, prescribers)}.`;
  if (limit === 1) return `${parsed.interpretedAs}: ${describe(hits[0].document, prescribers)}.`;
  if (limit !== undefined) return `${parsed.interpretedAs}: ${hits.map((h) => describe(h.document, prescribers)).join('; ')}.`;
  // Without a count, the grammar always lists newest first.
  return `${hits.length} ${parsed.nouns[hits.length === 1 ? 0 : 1]} in CareVault. Newest: ${describe(hits[0].document, prescribers)}.`;
}

/** The medicines recorded as taken, optionally only those with a given name. */
export function routineAnswer(routine: readonly RoutineMedicine[], medicine: string | null): { medicines: RoutineMedicine[]; text: string } {
  const named = (m: RoutineMedicine) => !medicine || hasWord(normalizeQuestion(m.productName), medicine) || m.ingredients.some((i) => i.name === medicine);
  const byName = (a: RoutineMedicine, b: RoutineMedicine) => a.productName.localeCompare(b.productName);
  const taking = routine.filter((m) => m.status === 'taking' && named(m)).sort(byName);
  const unconfirmed = routine.filter((m) => m.status === 'uncertain' && named(m)).sort(byName);
  const parts: string[] = [];
  parts.push(taking.length > 0 ? `Recorded as taken: ${taking.map((m) => m.productName).join(', ')}.` : medicine ? `${capitalize(medicine)} is not recorded as taken.` : 'No medicine is recorded as taken.');
  if (unconfirmed.length > 0) parts.push(`Not confirmed: ${unconfirmed.map((m) => m.productName).join(', ')}.`);
  return { medicines: taking, text: parts.join(' ') };
}

export function questionsAnswer(visit: Visit | null, prescribers: readonly Prescriber[]): { questions: Question[]; text: string } {
  if (!visit) return { questions: [], text: 'No upcoming visit is saved in CareVault.' };
  const doctor = prescribers.find((p) => p.id === visit.prescriberId)?.name ?? 'the doctor';
  const count = visit.questions.length;
  const when = formatDate(visit.at.slice(0, 10));
  return {
    questions: visit.questions,
    text: count === 0 ? `No questions saved yet for the visit with ${doctor} on ${when}.` : `${count} ${count === 1 ? 'question' : 'questions'} saved for the visit with ${doctor} on ${when}.`,
  };
}
