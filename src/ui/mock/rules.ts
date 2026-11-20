// Simple, pure versions of the behaviour rules (overview spec section 9) for the mock.
// The real, fully tested rules engine lives in src/core and is never imported here.
import type * as T from '../../contract/legacy/types';

export const ACTIVE_STATUSES: T.MedicineStatus[] = ['found_at_home', 'confirmed_current', 'needs_confirmation'];

export function isActive(m: T.Medicine): boolean {
  return ACTIVE_STATUSES.includes(m.status);
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Sorted, normalized ingredient names. Brand names are never used for matching. */
export function ingredientKey(ingredients: T.Ingredient[]): string {
  return [...new Set(ingredients.map((i) => normalizeName(i.name)))].sort().join('+');
}

export function sameMedicine(a: T.Ingredient[], b: T.Ingredient[]): boolean {
  return ingredientKey(a) === ingredientKey(b);
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const MASS_TO_MG: Partial<Record<T.DoseUnit, number>> = { mcg: 0.001, mg: 1, g: 1000 };

/** Mass units convert to mg; ml and IU stay as they are and never sum with mass. */
export function toCommonUnit(strength: number, unit: T.DoseUnit): { value: number; unit: T.DoseUnit } {
  const factor = MASS_TO_MG[unit];
  return factor === undefined ? { value: strength, unit } : { value: round3(strength * factor), unit: 'mg' };
}

/** Only ingredients present in two or more active medicines. */
export function computeIngredientTotals(medicines: T.Medicine[]): T.IngredientTotal[] {
  const groups = new Map<string, T.IngredientTotal>();
  for (const m of medicines.filter(isActive)) {
    for (const ing of m.ingredients) {
      const name = normalizeName(ing.name);
      const common = toCommonUnit(ing.strength, ing.unit);
      const key = `${name}|${common.unit}`;
      const group = groups.get(key) ?? { ingredient: name, unit: common.unit, perDay: 0, parts: [], complete: true };
      const perDay = m.dosesPerDay === null ? 0 : round3(common.value * m.dosesPerDay);
      if (m.dosesPerDay === null) group.complete = false;
      group.parts.push({ medicineId: m.id, productName: m.productName, perDay });
      group.perDay = round3(group.perDay + perDay);
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((g) => new Set(g.parts.map((p) => p.medicineId)).size >= 2);
}

export function describeStrength(ingredients: T.Ingredient[]): string {
  return ingredients.map((i) => `${i.strength} ${i.unit}`).join(' + ');
}

function strengthSignature(ingredients: T.Ingredient[]): string {
  return [...ingredients]
    .map((i) => {
      const c = toCommonUnit(i.strength, i.unit);
      return `${normalizeName(i.name)}:${c.value}${c.unit}`;
    })
    .sort()
    .join('|');
}

export type LineLike = Pick<T.PrescriptionLine, 'ingredients' | 'dosesPerDay' | 'instruction' | 'form'>;

export function strengthDiffers(a: LineLike, b: LineLike): boolean {
  return strengthSignature(a.ingredients) !== strengthSignature(b.ingredients);
}

export function linesIdentical(a: LineLike, b: LineLike): boolean {
  return (
    !strengthDiffers(a, b) &&
    a.dosesPerDay === b.dosesPerDay &&
    a.form === b.form &&
    normalizeName(a.instruction) === normalizeName(b.instruction)
  );
}

export const REVIEW_NOTE = 'CareVault does not assume it was stopped. Please confirm what is being taken.';

const KIND_ORDER: Record<T.DiffKind, number> = { added: 0, changed: 1, review: 2, unchanged: 3 };

/** Rows without review item ids, ordered added, changed, review, unchanged. */
export function diffLines(previous: T.PrescriptionLine[] | null, latest: T.PrescriptionLine[]): T.PrescriptionDiffRow[] {
  const rows: T.PrescriptionDiffRow[] = [];
  const prev = previous ?? [];
  const matched = new Set<string>();

  for (const line of latest) {
    const before = prev.find((p) => !matched.has(p.id) && sameMedicine(p.ingredients, line.ingredients));
    if (!before) {
      rows.push({
        kind: 'added',
        previous: null,
        latest: line,
        note: previous === null ? 'First prescription from this prescriber in CareVault' : 'New on this prescription',
        reviewItemId: null,
      });
      continue;
    }
    matched.add(before.id);
    if (linesIdentical(before, line)) {
      rows.push({ kind: 'unchanged', previous: before, latest: line, note: '', reviewItemId: null });
    } else {
      const note = strengthDiffers(before, line)
        ? `${describeStrength(before.ingredients)} to ${describeStrength(line.ingredients)}`
        : `"${before.instruction}" to "${line.instruction}"`;
      rows.push({ kind: 'changed', previous: before, latest: line, note, reviewItemId: null });
    }
  }
  for (const before of prev) {
    if (!matched.has(before.id)) {
      rows.push({ kind: 'review', previous: before, latest: null, note: REVIEW_NOTE, reviewItemId: null });
    }
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] || a.index - b.index)
    .map(({ row }) => row);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-28' -> '28 Oct'. Parsed by hand so the time zone never shifts the day. */
export function shortDate(iso: T.ISODate): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
