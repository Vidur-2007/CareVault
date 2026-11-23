// Records search and the deterministic Ask parser for the v2 mock (overview 9.8). No language model.
import type * as T from '../../../contract/types';
import type { MockCtx } from './state';
import { nextVisit } from './routine';
import { longDate, norm } from './text';

/** Newest clinical date first; undated after dated ones, newest added first (9.1). */
export function byClinicalDate(order: 'newest' | 'oldest' = 'newest') {
  return (a: T.DocumentRecord, b: T.DocumentRecord) => {
    if (a.clinicalDate && b.clinicalDate) {
      const c = a.clinicalDate.localeCompare(b.clinicalDate) || a.addedAt.localeCompare(b.addedAt);
      return order === 'newest' ? -c : c;
    }
    if (a.clinicalDate) return -1;
    if (b.clinicalDate) return 1;
    return b.addedAt.localeCompare(a.addedAt);
  };
}

const includesCI = (haystack: string | null | undefined, needle: string) => !!haystack && norm(haystack).includes(norm(needle));

/** records.search: every RecordQuery field filters; `text` says what matched. */
export function searchRecords(ctx: MockCtx, profileId: T.ID, query: T.RecordQuery): T.RecordHit[] {
  const { state } = ctx;
  const prescriber = (id: T.ID | null) => state.prescribers.find((p) => p.id === id) ?? null;
  const text = query.text?.trim() ? norm(query.text) : '';

  const textMatches = (d: T.DocumentRecord): string[] => {
    const p = prescriber(d.prescriberId);
    const fields: [string, string[]][] = [
      ['title', [d.title]],
      ['tag', d.tags],
      ['test name', d.testNames],
      ['facility', d.facility ? [d.facility] : []],
      ['doctor', p ? [p.name] : []],
      ['specialty', p?.specialty ? [p.specialty] : []],
    ];
    const phrase = fields.filter(([, values]) => values.some((v) => includesCI(v, text))).map(([name]) => name);
    if (phrase.length) return phrase;
    // Every word must match somewhere.
    const words = text.split(' ').filter((w) => w.length > 1);
    const perWord = words.map((w) => fields.filter(([, values]) => values.some((v) => includesCI(v, w))).map(([name]) => name));
    return words.length && perWord.every((m) => m.length) ? [...new Set(perWord.flat())] : [];
  };

  const hits: T.RecordHit[] = [];
  for (const d of state.documents.filter((x) => x.profileId === profileId)) {
    const matchedOn: string[] = [];
    if (query.kinds?.length) {
      if (!query.kinds.includes(d.kind)) continue;
      matchedOn.push('kind');
    }
    if (query.tags?.length) {
      if (!query.tags.every((t) => d.tags.some((x) => norm(x) === norm(t)))) continue;
      matchedOn.push('tag');
    }
    if (query.testName) {
      const wanted = norm(query.testName);
      if (!d.testNames.some((t) => norm(t).includes(wanted) || wanted.includes(norm(t)))) continue;
      matchedOn.push('test name');
    }
    if (query.prescriberId) {
      if (d.prescriberId !== query.prescriberId) continue;
      matchedOn.push('doctor');
    }
    if (query.facility) {
      if (!includesCI(d.facility, query.facility)) continue;
      matchedOn.push('facility');
    }
    if (query.from || query.to) {
      if (!d.clinicalDate || (query.from && d.clinicalDate < query.from) || (query.to && d.clinicalDate > query.to)) continue;
      matchedOn.push('date');
    }
    if (query.starredOnly && !d.starred) continue;
    if (text) {
      const m = textMatches(d);
      if (!m.length) continue;
      matchedOn.push(...m);
    }
    hits.push({ document: d, matchedOn: [...new Set(matchedOn)] });
  }
  hits.sort((a, b) => byClinicalDate(query.sort ?? 'newest')(a.document, b.document));
  return query.limit !== undefined ? hits.slice(0, Math.max(0, query.limit)) : hits;
}

// ---------- Ask ----------

const TESTS: [RegExp, string][] = [
  [/lipid/, 'Lipid profile'],
  [/hba1c|a1c|glycated/, 'HbA1c'],
  [/thyroid|tsh/, 'Thyroid profile'],
  [/\becg\b|\bekg\b|electrocardiogram/, 'ECG'],
  [/kidney|renal|creatinine/, 'Kidney function test'],
  [/liver|\blft\b/, 'Liver function test'],
  [/\bcbc\b|complete blood count|blood count/, 'Complete blood count'],
  [/blood sugar|glucose/, 'Blood sugar'],
  [/urine/, 'Urine test'],
];

const KINDS: [RegExp, T.DocumentKind[], string][] = [
  [/prescription|\brx\b/, ['prescription'], 'prescription'],
  [/lab report|lab test|blood test|\blab\b/, ['lab_report'], 'lab report'],
  [/x-?ray|\bmri\b|\bct\b|ultrasound|scan|imaging/, ['imaging'], 'imaging report'],
  [/discharge/, ['discharge_summary'], 'discharge summary'],
  [/certificate/, ['certificate'], 'certificate'],
  [/consultation/, ['consultation'], 'consultation note'],
  [/\breports?\b|\btests?\b|results?/, ['lab_report', 'test', 'imaging', 'discharge_summary'], 'report'],
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const HINT = 'Try "latest lipid profile", "prescriptions from my cardiologist", "reports from 2026" or "what questions did I save".';

const notUnderstood = (): T.AskAnswer => ({
  understood: false, kind: 'not_understood', interpretedAs: '', query: null, documents: [], questions: [], medicines: [],
  text: `CareVault could not understand this question. ${HINT}`,
});

const pad = (n: number) => String(n).padStart(2, '0');

export function ask(ctx: MockCtx, profileId: T.ID, question: string): T.AskAnswer {
  const q = ` ${norm(question).replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ')} `;
  if (!q.trim()) return notUnderstood();
  const { state } = ctx;
  const today = ctx.today(profileId);

  if (/\bquestions?\b/.test(q)) {
    const visit = nextVisit(ctx, profileId);
    const questions = visit?.questions ?? [];
    const n = questions.length;
    return {
      understood: true, kind: 'questions', interpretedAs: 'Questions saved for the next visit', query: null,
      documents: [], questions, medicines: [],
      text: !visit ? 'No visit is planned yet, so no questions are saved.'
        : n === 0 ? `No questions are saved for the visit on ${longDate(visit.at)}.`
          : `${n === 1 ? 'One question is' : `${n} questions are`} saved for the visit on ${longDate(visit.at)}.`,
    };
  }

  const test = TESTS.find(([re]) => re.test(q));
  const kind = test ? undefined : KINDS.find(([re]) => re.test(q));

  if (!test && !kind && /\b(medicines?|medications?|routine|tablets|pills)\b/.test(q)) {
    const medicines = state.routine.filter((m) => m.profileId === profileId && m.status === 'taking')
      .sort((a, b) => a.productName.localeCompare(b.productName));
    const n = medicines.length;
    return {
      understood: true, kind: 'routine', interpretedAs: 'Medicines currently taken', query: null,
      documents: [], questions: [], medicines,
      text: n === 0 ? 'No medicines are listed as taken.' : `${n === 1 ? 'One medicine is' : `${n} medicines are`} listed as taken.`,
    };
  }

  const query: T.RecordQuery = { sort: 'newest' };
  const parts: string[] = [];
  let kindLabel = 'record';
  if (test) {
    query.testName = test[1];
    kindLabel = test[1] === 'ECG' ? 'ECG report' : 'report';
  } else if (kind) {
    query.kinds = kind[1];
    kindLabel = kind[2];
  }

  // A doctor by name or by specialty ("my cardiologist").
  const prescribers = state.prescribers.filter((p) => p.profileId === profileId);
  const doctor = prescribers.find((p) => {
    const words = norm(p.name).replace(/^dr\.?\s*/, '').split(' ');
    const surname = words.at(-1) ?? '';
    const stem = norm(p.specialty).replace(/(y|ist)$/, '');
    return (surname.length > 2 && q.includes(` ${surname} `)) || (stem.length > 3 && q.includes(stem));
  });
  if (doctor) {
    query.prescriberId = doctor.id;
    parts.push(`from ${doctor.name}`);
  }

  const facilities = [...new Set(state.documents.filter((d) => d.profileId === profileId && d.facility).map((d) => d.facility!))];
  const facility = facilities.find((f) => q.includes(norm(f)) || q.includes(` ${norm(f).split(' ')[0]} `));
  if (facility) {
    query.facility = facility;
    parts.push(`at ${facility}`);
  }

  const year = q.match(/\b(19|20)\d{2}\b/)?.[0];
  const monthIndex = MONTHS.findIndex((m) => q.includes(` ${m} `) || q.includes(` ${m.slice(0, 3)} `));
  const thisYear = Number(today.slice(0, 4));
  if (monthIndex >= 0) {
    const y = year ? Number(year) : thisYear;
    const last = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
    query.from = `${y}-${pad(monthIndex + 1)}-01`;
    query.to = `${y}-${pad(monthIndex + 1)}-${pad(last)}`;
    parts.push(`in ${MONTHS[monthIndex][0].toUpperCase()}${MONTHS[monthIndex].slice(1)} ${y}`);
  } else if (year || /last year|this year/.test(q)) {
    const y = year ? Number(year) : q.includes('last year') ? thisYear - 1 : thisYear;
    query.from = `${y}-01-01`;
    query.to = `${y}-12-31`;
    parts.push(`in ${y}`);
  }

  if (!test && !kind && !doctor && !facility && !query.from) return notUnderstood();

  let lead = '';
  const lastN = q.match(/\blast (\d+|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (lastN) {
    const n = /\d/.test(lastN[1]) ? Number(lastN[1]) : NUMBER_WORDS.indexOf(lastN[1]);
    query.limit = n;
    lead = `Last ${n} `;
  } else if (/\b(first|earliest|oldest)\b/.test(q)) {
    query.sort = 'oldest';
    query.limit = 1;
    lead = 'Earliest ';
  } else if (/\b(latest|last|newest|most recent|recent)\b/.test(q.replace(/last year/g, ''))) {
    query.limit = 1;
    lead = 'Latest ';
  }

  const plural = query.limit === 1 ? kindLabel : `${kindLabel}s`;
  const what = test && kindLabel !== 'ECG report' ? `${plural} with ${test[1]}` : plural;
  const interpretedAs = `${lead}${lead ? what : what[0].toUpperCase() + what.slice(1)}${parts.length ? ` ${parts.join(' ')}` : ''}`;
  const documents = searchRecords(ctx, profileId, query);

  let text: string;
  if (!documents.length) text = `No ${plural} found in CareVault.`;
  else if (query.limit === 1) {
    const d = documents[0].document;
    const where = d.facility ?? state.prescribers.find((p) => p.id === d.prescriberId)?.name ?? null;
    const when = d.clinicalDate ? longDate(d.clinicalDate) : 'undated';
    text = `${interpretedAs}: ${[when, where].filter(Boolean).join(', ')}.`;
    if (query.sort === 'oldest') text += ' This is the earliest in CareVault, not necessarily the earliest ever.';
  } else {
    const newest = documents.find((h) => h.document.clinicalDate)?.document.clinicalDate;
    text = `${documents.length === 1 ? 'One record' : `${documents.length} records`} found${newest ? `; the latest is from ${longDate(newest)}` : ''}.`;
  }

  return { understood: true, kind: 'documents', interpretedAs, query, documents, questions: [], medicines: [], text };
}
