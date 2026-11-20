// Ingredient names and units. Matching in CareVault is by active ingredient only;
// brand names are never compared.
import type { DoseUnit, Ingredient } from '../../contract/legacy/types';
import { INGREDIENT_SYNONYMS } from '../drugref/synonyms';

// Pharmacopoeia marks printed after a name: 'Paracetamol IP', 'Metformin Ph. Eur.'
const PHARMACOPOEIA = new Set(['ip', 'bp', 'usp', 'ep', 'jp', 'nf', 'ph', 'eur']);

// Salt and hydrate words that follow the active part of a name.
const SALT_WORDS = new Set([
  'hydrochloride', 'dihydrochloride', 'hcl', 'hydrobromide',
  'besylate', 'besilate', 'maleate', 'mesylate', 'mesilate', 'tosylate',
  'succinate', 'tartrate', 'bitartrate', 'fumarate', 'citrate', 'acetate',
  'phosphate', 'sulphate', 'sulfate', 'bisulphate', 'bisulfate', 'nitrate',
  'sodium', 'potassium', 'calcium', 'magnesium',
  'hydrate', 'monohydrate', 'dihydrate', 'trihydrate', 'hemihydrate', 'sesquihydrate', 'anhydrous',
]);

// Names that start with one of these are mineral salts in their own right
// ('ferrous sulphate', 'calcium carbonate'). Their last word is part of the name.
const LEADING_CATIONS = new Set([
  'sodium', 'potassium', 'calcium', 'magnesium', 'ferrous', 'ferric',
  'zinc', 'lithium', 'aluminium', 'aluminum', 'ammonium',
]);

function synonym(name: string): string {
  return Object.hasOwn(INGREDIENT_SYNONYMS, name) ? INGREDIENT_SYNONYMS[name] : name;
}

/**
 * 'Amlodipine Besylate IP' -> 'amlodipine', 'Acetaminophen' -> 'paracetamol'.
 * Lowercases, trims, drops bracketed notes, pharmacopoeia marks and salt words,
 * then maps synonyms.
 */
export function normalizeIngredientName(raw: string): string {
  const lowered = raw.normalize('NFKC').toLowerCase();
  const tokenize = (text: string) =>
    text
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  // '(as besylate)' and similar notes are dropped, unless nothing else is left.
  let tokens = tokenize(lowered.replace(/\([^)]*\)/g, ' '));
  if (tokens.length === 0) tokens = tokenize(lowered);
  if (tokens.length === 0) return '';

  const keepsSalt = LEADING_CATIONS.has(tokens[0]);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (PHARMACOPOEIA.has(last) || (!keepsSalt && SALT_WORDS.has(last))) tokens.pop();
    else break;
  }
  return synonym(tokens.join(' '));
}

/** Ingredients as they are stored: normalized names, original strengths and units. */
export function normalizeIngredients(ingredients: readonly Ingredient[]): Ingredient[] {
  return ingredients.map((i) => ({ name: normalizeIngredientName(i.name), strength: i.strength, unit: i.unit }));
}

export type BaseUnit = 'mcg' | 'ml' | 'IU';

const MCG_PER: Partial<Record<DoseUnit, number>> = { mcg: 1, mg: 1_000, g: 1_000_000 };

export function isMassUnit(unit: DoseUnit): boolean {
  return MCG_PER[unit] !== undefined;
}

/** Rounds away binary floating point noise (0.07 * 1000 = 70.00000000000001). */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Mass becomes micrograms. Volume (ml) and international units stay as they are. */
export function toBaseUnit(strength: number, unit: DoseUnit): { value: number; unit: BaseUnit } {
  const factor = MCG_PER[unit];
  if (factor === undefined) return { value: clean(strength), unit: unit as BaseUnit };
  return { value: clean(strength * factor), unit: 'mcg' };
}

/** Converts a base-unit value back into a display unit of the same kind. */
export function fromBaseUnit(value: number, unit: DoseUnit): number {
  return clean(value / (MCG_PER[unit] ?? 1));
}

/** At most three decimal places, for every total that is shown or compared. */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Sorted, de-duplicated normalized names. Two medicines match when their keys are equal. */
export function ingredientKey(ingredients: readonly Ingredient[]): string {
  return [...new Set(ingredients.map((i) => normalizeIngredientName(i.name)))].sort().join('+');
}

/** True when both contain exactly the same set of active ingredients. */
export function sameMedicine(a: readonly Ingredient[], b: readonly Ingredient[]): boolean {
  return ingredientKey(a) === ingredientKey(b);
}

/** '5 mg', or '500 mg + 125 mg' for a combination. */
export function describeStrength(ingredients: readonly Ingredient[]): string {
  return ingredients.map((i) => `${i.strength} ${i.unit}`).join(' + ');
}

/** Equal for two ingredient lists with the same names and the same amounts, in any unit. */
export function strengthSignature(ingredients: readonly Ingredient[]): string {
  return ingredients
    .map((i) => {
      const base = toBaseUnit(i.strength, i.unit);
      return `${normalizeIngredientName(i.name)}:${base.value}${base.unit}`;
    })
    .sort()
    .join('|');
}
