import type { Ingredient } from '../../contract/legacy/types';

export function strengthText(ingredients: Ingredient[]): string {
  return ingredients.map((i) => `${i.strength} ${i.unit}`).join(' + ');
}

/** Splits 'Amlodipine 5 mg' into base name and strength, so a changed strength can be marked. */
export function splitName(productName: string, ingredients: Ingredient[]): { base: string; strength: string | null } {
  const strength = strengthText(ingredients);
  if (strength && productName.toLowerCase().endsWith(strength.toLowerCase())) {
    return { base: productName.slice(0, productName.length - strength.length).trim(), strength };
  }
  return { base: productName, strength: null };
}

export function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** 'Paracetamol 650 mg' for one ingredient, 'Paracetamol 325 mg + caffeine 30 mg' for several. */
export function ingredientLine(ingredients: Ingredient[]): string {
  return ingredients.map((i, n) => `${n === 0 ? capitalize(i.name) : i.name} ${i.strength} ${i.unit}`).join(' + ');
}
