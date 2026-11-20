// Comparison of a prescription with the previous one from the same prescriber.
import type { DiffKind, PrescriptionLine } from '../../contract/legacy/types';
import { describeStrength, ingredientKey, strengthSignature } from './normalize';
import type { Pronouns } from './text';

export interface DiffRowDraft {
  kind: DiffKind;
  previous: PrescriptionLine | null;
  latest: PrescriptionLine | null;
  note: string;
}

export type ComparableLine = Pick<PrescriptionLine, 'ingredients' | 'dosesPerDay' | 'instruction' | 'form'>;

const tidy = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function strengthDiffers(a: ComparableLine, b: ComparableLine): boolean {
  return strengthSignature(a.ingredients) !== strengthSignature(b.ingredients);
}

/** Same amounts, same number per day, same form and the same instruction text. */
export function linesIdentical(a: ComparableLine, b: ComparableLine): boolean {
  return (
    !strengthDiffers(a, b) &&
    a.dosesPerDay === b.dosesPerDay &&
    a.form === b.form &&
    tidy(a.instruction) === tidy(b.instruction)
  );
}

const perDay = (doses: number | null) => (doses === null ? 'not stated' : `${doses} a day`);

/** What changed between two lines for the same medicine, in words: '5 mg to 10 mg'. */
export function describeChange(before: ComparableLine, after: ComparableLine): string {
  const changes: string[] = [];
  if (strengthDiffers(before, after)) {
    changes.push(`${describeStrength(before.ingredients)} to ${describeStrength(after.ingredients)}`);
  }
  if (before.dosesPerDay !== after.dosesPerDay) {
    changes.push(`${perDay(before.dosesPerDay)} to ${perDay(after.dosesPerDay)}`);
  }
  if (before.form !== after.form) changes.push(`${before.form} to ${after.form}`);
  if (changes.length === 0) changes.push(`"${before.instruction}" to "${after.instruction}"`);
  return changes.join(', ');
}

export const NOTE_FIRST_PRESCRIPTION = 'First prescription from this prescriber in CareVault';
export const NOTE_ADDED = 'New on this prescription';

export function reviewNote(pronouns: Pronouns): string {
  return `CareVault does not assume it was stopped. Please confirm what ${pronouns.subject} ${pronouns.be} taking.`;
}

const KIND_ORDER: Record<DiffKind, number> = { added: 0, changed: 1, review: 2, unchanged: 3 };

/**
 * Lines match when their sets of normalized ingredient names are equal. Brand names are
 * never compared.
 *
 * - on the latest only: `added`
 * - on both, anything different: `changed`
 * - on both, identical: `unchanged`
 * - on the previous only: `review`. A missing medicine is a question, never a stop.
 *
 * `previous` is null when this is the first prescription from the prescriber; every row
 * is then `added`. Rows come back in display order: added, changed, review, unchanged.
 */
export function diffPrescriptions(
  previous: readonly PrescriptionLine[] | null,
  latest: readonly PrescriptionLine[],
  pronouns: Pronouns = { subject: 'they', possessive: 'their', be: 'are' },
): DiffRowDraft[] {
  const rows: DiffRowDraft[] = [];
  const before = previous ?? [];
  const matched = new Set<PrescriptionLine>();

  for (const line of latest) {
    const key = ingredientKey(line.ingredients);
    const match = before.find((p) => !matched.has(p) && ingredientKey(p.ingredients) === key);
    if (!match) {
      rows.push({
        kind: 'added',
        previous: null,
        latest: line,
        note: previous === null ? NOTE_FIRST_PRESCRIPTION : NOTE_ADDED,
      });
    } else {
      matched.add(match);
      if (linesIdentical(match, line)) {
        rows.push({ kind: 'unchanged', previous: match, latest: line, note: '' });
      } else {
        rows.push({ kind: 'changed', previous: match, latest: line, note: describeChange(match, line) });
      }
    }
  }

  for (const line of before) {
    if (!matched.has(line)) {
      rows.push({ kind: 'review', previous: line, latest: null, note: reviewNote(pronouns) });
    }
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] || a.index - b.index)
    .map(({ row }) => row);
}
