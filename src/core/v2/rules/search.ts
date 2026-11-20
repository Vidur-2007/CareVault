// Records search (overview 9.8). Pure: the profile's documents and doctors in, hits out.
// Every RecordQuery field filters; results say what matched.
import type { DocumentRecord, ID, Prescriber, RecordHit, RecordQuery } from '../../../contract/types';

export const MATCHED = {
  title: 'title',
  tag: 'tag',
  testName: 'test name',
  facility: 'facility',
  doctor: 'doctor',
  kind: 'kind',
  date: 'date',
  starred: 'starred',
  medicine: 'medicine',
} as const;

const lower = (text: string) => text.toLowerCase();
const words = (text: string) => lower(text).split(/[^a-z0-9]+/).filter(Boolean);

/** Newest clinical date first; undated records after dated ones, newest added first. */
export function newestFirst(a: DocumentRecord, b: DocumentRecord): number {
  if (a.clinicalDate && b.clinicalDate && a.clinicalDate !== b.clinicalDate) return b.clinicalDate.localeCompare(a.clinicalDate);
  if (a.clinicalDate && !b.clinicalDate) return -1;
  if (!a.clinicalDate && b.clinicalDate) return 1;
  return Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.id.localeCompare(b.id);
}

/** Oldest clinical date first; undated records still after dated ones, oldest added first. */
export function oldestFirst(a: DocumentRecord, b: DocumentRecord): number {
  if (a.clinicalDate && b.clinicalDate && a.clinicalDate !== b.clinicalDate) return a.clinicalDate.localeCompare(b.clinicalDate);
  if (a.clinicalDate && !b.clinicalDate) return -1;
  if (!a.clinicalDate && b.clinicalDate) return 1;
  return Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.id.localeCompare(b.id);
}

/**
 * Where free text matches. The whole phrase in one field counts first; otherwise every word
 * must be found somewhere. Null when it does not match.
 */
export function matchText(text: string, doc: DocumentRecord, prescriber: Prescriber | undefined): string[] | null {
  const fields: [string, string][] = [
    [MATCHED.title, doc.title],
    ...doc.tags.map((t): [string, string] => [MATCHED.tag, t]),
    ...doc.testNames.map((t): [string, string] => [MATCHED.testName, t]),
    ...(doc.facility ? [[MATCHED.facility, doc.facility] as [string, string]] : []),
    ...(prescriber ? [[MATCHED.doctor, `${prescriber.name} ${prescriber.specialty}`] as [string, string]] : []),
  ];
  const phrase = lower(text.trim());
  const whole = fields.filter(([, value]) => lower(value).includes(phrase)).map(([label]) => label);
  if (whole.length > 0) return [...new Set(whole)];
  const labels: string[] = [];
  for (const word of words(phrase)) {
    const found = fields.filter(([, value]) => words(value).some((w) => w.startsWith(word))).map(([label]) => label);
    if (found.length === 0) return null;
    labels.push(...found);
  }
  // Only punctuation: nothing to match on.
  return labels.length > 0 ? [...new Set(labels)] : null;
}

export function searchRecords(
  documents: readonly DocumentRecord[],
  prescribers: readonly Prescriber[],
  query: RecordQuery,
  /** Only for Ask: documents that mention the medicine asked about. */
  onlyIds?: ReadonlySet<ID>,
): RecordHit[] {
  const doctors = new Map(prescribers.map((p) => [p.id, p]));
  const hits: RecordHit[] = [];
  for (const doc of documents) {
    const matchedOn: string[] = [];
    if (onlyIds) {
      if (!onlyIds.has(doc.id)) continue;
      matchedOn.push(MATCHED.medicine);
    }
    if (query.kinds?.length) {
      if (!query.kinds.includes(doc.kind)) continue;
      matchedOn.push(MATCHED.kind);
    }
    if (query.tags?.length) {
      const tags = new Set(doc.tags.map(lower));
      if (!query.tags.every((t) => tags.has(lower(t.trim())))) continue;
      matchedOn.push(MATCHED.tag);
    }
    if (query.testName !== undefined) {
      if (!doc.testNames.some((t) => lower(t) === lower(query.testName!.trim()))) continue;
      matchedOn.push(MATCHED.testName);
    }
    if (query.prescriberId !== undefined) {
      if (doc.prescriberId !== query.prescriberId) continue;
      matchedOn.push(MATCHED.doctor);
    }
    if (query.facility !== undefined) {
      if (!doc.facility || !lower(doc.facility).includes(lower(query.facility.trim()))) continue;
      matchedOn.push(MATCHED.facility);
    }
    if (query.from !== undefined || query.to !== undefined) {
      // A record with no known date cannot be said to fall in a period.
      if (!doc.clinicalDate) continue;
      if (query.from !== undefined && doc.clinicalDate < query.from) continue;
      if (query.to !== undefined && doc.clinicalDate > query.to) continue;
      matchedOn.push(MATCHED.date);
    }
    if (query.starredOnly) {
      if (!doc.starred) continue;
      matchedOn.push(MATCHED.starred);
    }
    if (query.text !== undefined && query.text.trim()) {
      const where = matchText(query.text, doc, doc.prescriberId ? doctors.get(doc.prescriberId) : undefined);
      if (where === null) continue;
      matchedOn.push(...where);
    }
    hits.push({ document: doc, matchedOn: [...new Set(matchedOn)] });
  }
  hits.sort((a, b) => (query.sort === 'oldest' ? oldestFirst : newestFirst)(a.document, b.document));
  const limit = query.limit;
  return limit !== undefined && limit > 0 ? hits.slice(0, Math.floor(limit)) : hits;
}
