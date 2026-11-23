// Pure helpers for Records and the record detail (UI spec 4.3, 4.5). Unit-tested.
import type { DocumentKind, DocumentRecord, ISODate, PassportSnapshot, RecordQuery } from '../../../contract/types';
import { formatDate } from '../../lib/format';
import { KIND_ORDER } from '../../lib/labels';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const UNDATED_KEY = 'undated';
export const UNDATED_LABEL = 'Date not known';

export interface TimelineGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * Groups by month of the clinical date, in the order given (the search already sorted them);
 * undated records always form the final "Date not known" group.
 */
export function groupByMonth<T>(items: T[], docOf: (item: T) => DocumentRecord): TimelineGroup<T>[] {
  const groups: TimelineGroup<T>[] = [];
  const undated: T[] = [];
  for (const item of items) {
    const date = docOf(item).clinicalDate;
    if (!date) {
      undated.push(item);
      continue;
    }
    const key = date.slice(0, 7);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const [y, m] = key.split('-').map(Number);
      group = { key, label: `${MONTHS[m - 1]} ${y}`, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  if (undated.length) groups.push({ key: UNDATED_KEY, label: UNDATED_LABEL, items: undated });
  return groups;
}

/** Kinds present in the records, in chip order, with counts. */
export function kindCounts(docs: DocumentRecord[]): { kind: DocumentKind; count: number }[] {
  return KIND_ORDER.map((kind) => ({ kind, count: docs.filter((d) => d.kind === kind).length })).filter((k) => k.count > 0);
}

/** Facilities named on the records, A to Z. */
export function facilitiesOf(docs: DocumentRecord[]): string[] {
  return [...new Set(docs.map((d) => d.facility).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b));
}

/** "Matched: test name, doctor". */
export function matchedText(matchedOn: string[]): string | null {
  return matchedOn.length ? `Matched: ${matchedOn.join(', ')}` : null;
}

/** A phrase that reads like a question for Ask ("latest lipid profile", "what did Dr. Rao prescribe?"). */
export function isQuestionLike(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.split(/\s+/).length < 2) return false;
  return t.endsWith('?')
    || /^(latest|last|first|earliest|newest|oldest|recent|most recent|what|when|which|who|show|how many|all)\b/.test(t)
    || /\bfrom my\b|\bin (19|20)\d{2}\b|\blast year\b/.test(t);
}

export interface Filters {
  text: string;
  kind: DocumentKind | null;
  starredOnly: boolean;
  prescriberId: string;
  facility: string;
  from: string;
  to: string;
  sort: 'newest' | 'oldest';
}

export const NO_FILTERS: Filters = { text: '', kind: null, starredOnly: false, prescriberId: '', facility: '', from: '', to: '', sort: 'newest' };

export const filtersActive = (f: Filters) =>
  f.text.trim() !== '' || f.kind !== null || f.starredOnly || f.prescriberId !== '' || f.facility !== '' || f.from !== '' || f.to !== '';

/** The RecordQuery for the chosen search and filters. */
export function toQuery(f: Filters): RecordQuery {
  const q: RecordQuery = { sort: f.sort };
  if (f.text.trim()) q.text = f.text.trim();
  if (f.kind) q.kinds = [f.kind];
  if (f.starredOnly) q.starredOnly = true;
  if (f.prescriberId) q.prescriberId = f.prescriberId;
  if (f.facility) q.facility = f.facility;
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  return q;
}

// ---------- editing the details ----------

export interface DetailsValues {
  kind: DocumentKind;
  title: string;
  /** '' = date not known. */
  clinicalDate: string;
  prescriberId: string;
  facility: string;
  tags: string;
  testNames: string;
}

export type DetailsErrors = Partial<Record<keyof DetailsValues, string>>;

export const splitList = (s: string) => [...new Set(s.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))];

export function detailsFrom(doc: DocumentRecord): DetailsValues {
  return {
    kind: doc.kind, title: doc.title, clinicalDate: doc.clinicalDate ?? '', prescriberId: doc.prescriberId ?? '',
    facility: doc.facility ?? '', tags: doc.tags.join(', '), testNames: doc.testNames.join(', '),
  };
}

export function validateDetails(v: DetailsValues, today: ISODate): DetailsErrors {
  const errors: DetailsErrors = {};
  const title = v.title.trim();
  if (!title) errors.title = 'Please give the record a title, like “Lipid profile”.';
  else if (title.length > 80) errors.title = 'Please use 80 characters or fewer.';
  if (v.clinicalDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.clinicalDate)) errors.clinicalDate = 'Please enter the date on the document, or leave it empty.';
  else if (v.clinicalDate > today) errors.clinicalDate = 'The date on the document cannot be in the future.';
  if (v.facility.trim().length > 120) errors.facility = 'Please use 120 characters or fewer.';
  return errors;
}

/** Only the fields that changed, for documents.update. */
export function detailsPatch(doc: DocumentRecord, v: DetailsValues) {
  const patch: Partial<Pick<DocumentRecord, 'kind' | 'title' | 'clinicalDate' | 'prescriberId' | 'facility' | 'tags' | 'testNames'>> = {};
  const title = v.title.trim().replace(/\s+/g, ' ');
  const date = v.clinicalDate || null;
  const prescriberId = v.prescriberId || null;
  const facility = v.facility.trim() || null;
  const tags = splitList(v.tags).map((t) => t.toLowerCase());
  const testNames = splitList(v.testNames);
  if (v.kind !== doc.kind) patch.kind = v.kind;
  if (title !== doc.title) patch.title = title;
  if (date !== doc.clinicalDate) patch.clinicalDate = date;
  if (prescriberId !== doc.prescriberId) patch.prescriberId = prescriberId;
  if (facility !== doc.facility) patch.facility = facility;
  if (tags.join('|') !== doc.tags.join('|')) patch.tags = tags;
  if (testNames.join('|') !== doc.testNames.join('|')) patch.testNames = testNames;
  return patch;
}

// ---------- deleting ----------

const REASON: Record<PassportSnapshot['reason'], string> = { manual: 'saved', print: 'printed', share: 'shared' };

/** "Passport revision 2, shared on 14 Nov 2026". */
export const snapshotLabel = (s: PassportSnapshot) => `Passport revision ${s.revision}, ${REASON[s.reason]} on ${formatDate(s.createdAt)}`;
