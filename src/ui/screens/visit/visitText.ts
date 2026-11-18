// Pure helpers for the Visit screen (UI spec 7.8). Unit-tested.
import type { DiffKind, PrescriptionDiffRow, ReviewItem } from '../../../contract/types';
import { strengthText } from '../../components/lineText';
import { formatDayMonth } from '../../lib/format';
import type { Pronouns } from '../../lib/pronouns';
import { plural } from '../review/copy';

const ORDER: Record<DiffKind, number> = { added: 0, changed: 1, review: 2, unchanged: 3 };

/** Added, changed, review, unchanged; the original order inside each kind. */
export function orderRows(rows: PrescriptionDiffRow[]): PrescriptionDiffRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => ORDER[a.row.kind] - ORDER[b.row.kind] || a.i - b.i)
    .map(({ row }) => row);
}

/** Review rows whose review item is still open and not waiting out its Undo window. */
export function unansweredCount(rows: PrescriptionDiffRow[], openItems: ReviewItem[], hidden: ReadonlySet<string>): number {
  return rows.filter(
    (r) => r.kind === 'review' && r.reviewItemId !== null && !hidden.has(r.reviewItemId) && openItems.some((i) => i.id === r.reviewItemId),
  ).length;
}

export function statusTitle(count: number): string {
  return count === 0 ? 'Everything is answered' : `${count} ${plural(count, 'item still needs', 'items still need')} your answer`;
}

export function statusBody(count: number): string {
  return count === 0
    ? 'The passport lists the confirmed medicines, the changes and your questions.'
    : 'You can open the passport now. Unanswered items appear on it as open questions.';
}

/** Sentence under a row, with the profile's pronouns where the mockup uses them. */
export function rowFootnote(row: PrescriptionDiffRow, pronouns: Pronouns, latestDate: string | null): string | undefined {
  if (row.kind === 'review') {
    const be = pronouns.subject === 'they' ? 'are' : 'is';
    return `CareVault does not assume it was stopped. Please confirm what ${pronouns.subject} ${be} taking.`;
  }
  if (row.kind === 'changed' && row.previous && row.latest && latestDate) {
    const before = strengthText(row.previous.ingredients);
    const after = strengthText(row.latest.ingredients);
    return before !== after
      ? `The ${before} strength is listed as replaced by ${after} from ${formatDayMonth(latestDate)}.`
      : `The instructions changed on ${formatDayMonth(latestDate)}.`;
  }
  return undefined;
}
