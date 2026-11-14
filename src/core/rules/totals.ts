// Duplicate ingredients and daily totals. CareVault adds up what was entered. It never
// compares a total with any limit.
import type { DoseUnit, IngredientTotal, Medicine } from '../../contract/types';
import {
  fromBaseUnit,
  isMassUnit,
  normalizeIngredientName,
  round3,
  toBaseUnit,
  type BaseUnit,
} from './normalize';
import { isActive } from './status';

export interface DuplicateGroup {
  ingredient: string;
  /** Two or more active medicines that contain it, oldest first. */
  medicines: Medicine[];
}

function oldestFirst(a: Medicine, b: Medicine): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

/** Every normalized ingredient that appears in two or more active medicines. */
export function duplicateGroups(medicines: readonly Medicine[]): DuplicateGroup[] {
  const byIngredient = new Map<string, Medicine[]>();
  for (const medicine of medicines.filter(isActive).sort(oldestFirst)) {
    const names = new Set(medicine.ingredients.map((i) => normalizeIngredientName(i.name)));
    for (const name of names) {
      byIngredient.set(name, [...(byIngredient.get(name) ?? []), medicine]);
    }
  }
  return [...byIngredient.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([ingredient, group]) => ({ ingredient, medicines: group }))
    .sort((a, b) => a.ingredient.localeCompare(b.ingredient));
}

const KINDS: readonly BaseUnit[] = ['mcg', 'ml', 'IU'];

interface Part {
  medicine: Medicine;
  /** Amount in one dose unit, in the base unit of its kind. */
  perDose: number;
  units: Set<DoseUnit>;
}

/**
 * The unit a mass total is shown in. One unit throughout stays as entered. Mixed units
 * use mg, unless that would need more than three decimals, in which case mcg.
 */
function massDisplayUnit(parts: Part[]): DoseUnit {
  const units = new Set(parts.flatMap((p) => [...p.units]));
  if (units.size === 1) return [...units][0];
  const exactInMg = parts.every((p) =>
    Number.isInteger(p.medicine.dosesPerDay === null ? p.perDose : p.perDose * p.medicine.dosesPerDay),
  );
  return exactInMg ? 'mg' : 'mcg';
}

/**
 * One total per ingredient that appears in two or more active medicines.
 * `perDay` of a part is strength x dosesPerDay. Mass units are converted to one unit;
 * volume (ml) and IU are never added to mass and get a total of their own.
 * If any part has no dosesPerDay, `complete` is false and no total is given (perDay 0).
 */
export function ingredientTotals(medicines: readonly Medicine[]): IngredientTotal[] {
  const totals: IngredientTotal[] = [];

  for (const group of duplicateGroups(medicines)) {
    for (const kind of KINDS) {
      const parts: Part[] = [];
      for (const medicine of group.medicines) {
        const matching = medicine.ingredients.filter(
          (i) =>
            normalizeIngredientName(i.name) === group.ingredient &&
            toBaseUnit(i.strength, i.unit).unit === kind,
        );
        if (matching.length === 0) continue;
        parts.push({
          medicine,
          perDose: matching.reduce((sum, i) => sum + toBaseUnit(i.strength, i.unit).value, 0),
          units: new Set(matching.map((i) => i.unit)),
        });
      }
      if (parts.length === 0) continue;

      const unit: DoseUnit = isMassUnit(kind) ? massDisplayUnit(parts) : kind;
      const complete = parts.every((p) => p.medicine.dosesPerDay !== null);
      let sum = 0;
      const shown = parts.map((p) => {
        const doses = p.medicine.dosesPerDay;
        const perDayBase = doses === null ? 0 : p.perDose * doses;
        sum += perDayBase;
        return {
          medicineId: p.medicine.id,
          productName: p.medicine.productName,
          perDay: round3(fromBaseUnit(perDayBase, unit)),
        };
      });

      totals.push({
        ingredient: group.ingredient,
        unit,
        perDay: complete ? round3(fromBaseUnit(sum, unit)) : 0,
        parts: shown,
        complete,
      });
    }
  }
  return totals;
}
