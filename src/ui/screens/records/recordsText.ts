// Pure helpers for the Records screens. Unit-tested.
import type { DocumentRecord, DocumentType, ExtractionCandidate, ISODate, Prescriber } from '../../../contract/legacy/types';
import { formatDate } from '../../lib/format';
import { DOCUMENT_TYPE_LABEL } from '../../lib/labels';

export type Category = 'all' | DocumentType;

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'prescription', label: 'Prescriptions' },
  { key: 'lab_report', label: 'Lab reports' },
  { key: 'test', label: 'Tests' },
  { key: 'discharge_summary', label: 'Discharge summaries' },
  { key: 'other', label: 'Other' },
];

export function countByCategory(docs: DocumentRecord[]): Record<Category, number> {
  const counts: Record<Category, number> = { all: docs.length, prescription: 0, lab_report: 0, test: 0, discharge_summary: 0, other: 0 };
  for (const d of docs) counts[d.type] += 1;
  return counts;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Newest month first; documents inside a month newest first. */
export function groupByMonth(docs: DocumentRecord[]): { key: string; label: string; docs: DocumentRecord[] }[] {
  const sorted = [...docs].sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.addedAt.localeCompare(a.addedAt));
  const groups: { key: string; label: string; docs: DocumentRecord[] }[] = [];
  for (const d of sorted) {
    const key = d.documentDate.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const [y, m] = key.split('-').map(Number);
      group = { key, label: `${MONTHS[m - 1]} ${y}`, docs: [] };
      groups.push(group);
    }
    group.docs.push(d);
  }
  return groups;
}

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^dr\.?\s+/, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Matches a name read from a document ("Dr. K. Rao", "Kavita Rao") to the profile's prescribers by surname. */
export function matchPrescriber(readName: string | null, prescribers: Prescriber[]): Prescriber | null {
  if (!readName) return null;
  const words = nameWords(readName);
  if (words.length === 0) return null;
  const surname = words[words.length - 1];
  const candidates = prescribers.filter((p) => nameWords(p.name).at(-1) === surname);
  if (candidates.length === 1) return candidates[0];
  return candidates.find((p) => nameWords(p.name).join(' ') === words.join(' ')) ?? null;
}

export function defaultTitle(type: DocumentType, prescriber: Prescriber | null, fileName: string): string {
  if (type === 'prescription') return prescriber?.specialty ? `${prescriber.specialty} prescription` : 'Prescription';
  if (type === 'lab_report') return 'Lab report';
  if (type === 'test') return 'Test report';
  if (type === 'discharge_summary') return 'Discharge summary';
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Document';
}

/** "Looks like a prescription from Dr. Kavita Rao dated 14 Nov 2026" */
export function looksLike(candidate: ExtractionCandidate | null): string | null {
  if (!candidate) return null;
  const what = DOCUMENT_TYPE_LABEL[candidate.documentType].toLowerCase();
  const article = /^[aeiou]/.test(what) ? 'an' : 'a';
  const from = candidate.prescriberName ? ` from ${candidate.prescriberName}` : '';
  const dated = candidate.documentDate ? ` dated ${formatDate(candidate.documentDate)}` : '';
  if (candidate.documentType === 'other' && !from && !dated) return null;
  return `Looks like ${article} ${what}${from}${dated}`;
}

export interface DetailsValues {
  type: DocumentType;
  title: string;
  documentDate: string;
  prescriberId: string; // '' = not from a doctor
}

export type DetailsErrors = Partial<Record<keyof DetailsValues, string>>;

export function validateDetails(values: DetailsValues, today: ISODate): DetailsErrors {
  const errors: DetailsErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = 'Please give the record a title, like “Lipid profile”.';
  else if (title.length > 80) errors.title = 'Please use 80 characters or fewer.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.documentDate)) errors.documentDate = 'Please enter the date on the document.';
  else if (values.documentDate > today) errors.documentDate = 'The date cannot be in the future.';
  if (values.type === 'prescription' && !values.prescriberId) errors.prescriberId = 'Please choose the doctor who wrote this prescription.';
  return errors;
}
