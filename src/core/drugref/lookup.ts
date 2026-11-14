// Lookup in the bundled drug reference. The reference is used to recognise product
// names and to cross-check what was read. It never overrides what the pack says.
import type { Ingredient, MedicineForm } from '../../contract/types';
import { normalizeIngredientName, strengthSignature } from '../rules/normalize';
import table from './table.json';

export interface DrugEntry {
  productName: string;
  aliases: string[];
  form: MedicineForm;
  ingredients: Ingredient[];
  /** Key into SOURCES.md. */
  source: string;
}

export interface DrugMatch {
  entry: DrugEntry;
  /** 1 for an exact name or alias, lower for a near match. */
  score: number;
}

export const DRUG_TABLE: readonly DrugEntry[] = table.products as DrugEntry[];

/** Lowercase, punctuation to spaces, single spaces: 'Dolo-650 ' -> 'dolo 650'. */
export function normalizeProductName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const numbersIn = (normalized: string) => normalized.split(' ').filter((token) => /^\d+(\.\d+)?$/.test(token));

interface IndexedName {
  entry: DrugEntry;
  normalized: string;
  compact: string;
  numbers: string[];
}

const INDEX: IndexedName[] = DRUG_TABLE.flatMap((entry) =>
  [entry.productName, ...entry.aliases].map((name) => {
    const normalized = normalizeProductName(name);
    return { entry, normalized, compact: normalized.replace(/ /g, ''), numbers: numbersIn(normalized) };
  }),
);

/** Edit distance, for names OCR has misread by a character or two. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}

/** Near matches below this are not offered. */
export const MIN_FUZZY_SCORE = 0.8;

/**
 * The best match for a product name: exact on the name or an alias (ignoring case and
 * punctuation), otherwise the closest name. A near match must agree on every number in
 * the name, so 'Rosuvas 20' is never taken for 'Rosuvas 10'.
 */
export function lookupProduct(name: string): DrugMatch | null {
  const normalized = normalizeProductName(name);
  if (!normalized) return null;
  const compact = normalized.replace(/ /g, '');
  const numbers = numbersIn(normalized);

  let best: DrugMatch | null = null;
  for (const candidate of INDEX) {
    let score: number;
    if (candidate.normalized === normalized || candidate.compact === compact) {
      score = 1;
    } else {
      if (candidate.numbers.join(' ') !== numbers.join(' ')) continue;
      score = similarity(candidate.compact, compact);
      if (score < MIN_FUZZY_SCORE) continue;
    }
    if (!best || score > best.score) best = { entry: candidate.entry, score };
    if (score === 1) break;
  }
  return best;
}

export interface TextMatch extends DrugMatch {
  /** Index of the line of text the product name was found on. */
  lineIndex: number;
}

/**
 * Product names from the reference that appear in a block of text, longest name first
 * on each line so 'Combiflam Plus' wins over 'Combiflam'. One match per line.
 */
export function findProductsInText(text: string): TextMatch[] {
  const matches: TextMatch[] = [];
  const byLength = [...INDEX].sort((a, b) => b.normalized.length - a.normalized.length);

  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const tokens = normalizeProductName(line).split(' ').filter(Boolean);
    if (tokens.length === 0) return;
    const padded = ` ${tokens.join(' ')} `;

    const exact = byLength.find((candidate) => padded.includes(` ${candidate.normalized} `));
    if (exact) {
      matches.push({ entry: exact.entry, score: 1, lineIndex });
      return;
    }

    // Near match: slide a window of as many words as the name has.
    let best: DrugMatch | null = null;
    for (const candidate of byLength) {
      const width = candidate.normalized.split(' ').length;
      for (let start = 0; start + width <= tokens.length; start += 1) {
        const window = tokens.slice(start, start + width);
        if (numbersIn(window.join(' ')).join(' ') !== candidate.numbers.join(' ')) continue;
        // A single short word is too easy to hit by accident.
        if (candidate.compact.length < 5) continue;
        const score = similarity(candidate.compact, window.join(''));
        if (score >= MIN_FUZZY_SCORE && (!best || score > best.score)) best = { entry: candidate.entry, score };
      }
    }
    if (best) matches.push({ ...best, lineIndex });
  });
  return matches;
}

const KNOWN_INGREDIENTS: ReadonlySet<string> = new Set([
  ...DRUG_TABLE.flatMap((entry) => entry.ingredients.map((i) => i.name)),
  ...Object.values(table.synonyms),
]);

/** True when the name, once normalized, is an ingredient the reference knows. */
export function isKnownIngredient(name: string): boolean {
  return KNOWN_INGREDIENTS.has(normalizeIngredientName(name));
}

const describe = (ingredients: readonly Ingredient[]) =>
  ingredients.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + ');

/**
 * Compares what was read with the reference and returns warnings. An empty list means
 * no disagreement was found. Nothing is corrected here: the caregiver decides.
 */
export function crossCheck(productName: string, ingredients: readonly Ingredient[]): string[] {
  const match = lookupProduct(productName);
  if (!match) {
    if (ingredients.length > 0 && ingredients.every((i) => isKnownIngredient(i.name))) return [];
    return ['This product is not in the drug reference. Please check the name and strength against the pack.'];
  }
  if (ingredients.length === 0) return [];
  if (strengthSignature(ingredients) === strengthSignature(match.entry.ingredients)) return [];
  return [
    `What was read does not match the drug reference for ${match.entry.productName} (${describe(match.entry.ingredients)}). Please check against the pack.`,
  ];
}
