// Editable draft of one medicine line (a scanned pack or one prescription line).
// Pure functions: parse an ExtractedLine into strings for the inputs, validate back into a line,
// and attach extraction warnings to the field they are about.
import type { DoseUnit, ExtractedLine, MedicineForm } from '../../../contract/types';

export interface IngredientDraft {
  /** Stable key so field markers survive adding and removing rows. */
  key: string;
  name: string;
  strength: string;
  unit: DoseUnit;
}

export interface LineDraft {
  productName: string;
  ingredients: IngredientDraft[];
  form: MedicineForm;
  dosesPerDay: string;
  instruction: string;
}

/** 'productName' | 'form' | 'dosesPerDay' | 'instruction' | 'ing.<key>.name|strength|unit' */
export type FieldPath = string;

export const DOSE_UNITS: DoseUnit[] = ['mcg', 'mg', 'g', 'ml', 'IU'];
export const MEDICINE_FORMS: { value: MedicineForm; label: string }[] = [
  { value: 'tablet', label: 'Tablet' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'syrup', label: 'Syrup' },
  { value: 'other', label: 'Other' },
];

let keySeq = 0;
export function newIngredientKey(): string {
  keySeq += 1;
  return `i${keySeq}`;
}

export function ingredientPath(key: string, part: 'name' | 'strength' | 'unit'): FieldPath {
  return `ing.${key}.${part}`;
}

export function draftFromLine(line: ExtractedLine): LineDraft {
  return {
    productName: line.productName,
    ingredients: (line.ingredients.length ? line.ingredients : [{ name: '', strength: 0, unit: 'mg' as DoseUnit }]).map((i) => ({
      key: newIngredientKey(),
      name: i.name,
      strength: i.strength ? String(i.strength) : '',
      unit: i.unit,
    })),
    form: line.form,
    dosesPerDay: line.dosesPerDay === null ? '' : String(line.dosesPerDay),
    instruction: line.instruction,
  };
}

export const EMPTY_LINE: ExtractedLine = {
  productName: '',
  ingredients: [{ name: '', strength: 0, unit: 'mg' }],
  form: 'tablet',
  dosesPerDay: null,
  instruction: '',
  warnings: [],
};

/** Every field path in the draft, used to mark all extracted fields as "Check this". */
export function allFieldPaths(draft: LineDraft): FieldPath[] {
  return [
    'productName',
    ...draft.ingredients.flatMap((i) => [ingredientPath(i.key, 'name'), ingredientPath(i.key, 'strength'), ingredientPath(i.key, 'unit')]),
    'form',
    'dosesPerDay',
    'instruction',
  ];
}

function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export type LineErrors = Record<FieldPath, string>;

/** Turns the draft back into a line. Numbers are never guessed: an invalid number is an error. */
export function validateDraft(draft: LineDraft): { line: ExtractedLine | null; errors: LineErrors } {
  const errors: LineErrors = {};
  const productName = draft.productName.trim().replace(/\s+/g, ' ');
  if (!productName) errors.productName = 'Please enter the name printed on the pack.';

  const ingredients = draft.ingredients.map((i) => {
    const name = i.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const strength = parseNumber(i.strength);
    if (!name) errors[ingredientPath(i.key, 'name')] = 'Please enter the ingredient.';
    if (strength === null || strength <= 0) errors[ingredientPath(i.key, 'strength')] = 'Please enter the strength as a number, like 650.';
    return { name, strength: strength ?? 0, unit: i.unit };
  });

  let dosesPerDay: number | null = null;
  if (draft.dosesPerDay.trim()) {
    const n = parseNumber(draft.dosesPerDay);
    if (n === null || n <= 0 || n > 24) errors.dosesPerDay = 'Please enter a number between 0.5 and 24, or leave it empty.';
    else dosesPerDay = n;
  }

  const instruction = draft.instruction.trim();
  if (instruction.length > 120) errors.instruction = 'Please use 120 characters or fewer.';

  if (Object.keys(errors).length > 0) return { line: null, errors };
  return { line: { productName, ingredients, form: draft.form, dosesPerDay, instruction, warnings: [] }, errors };
}

/** Field order for focusing the first error. */
export function fieldOrder(draft: LineDraft): FieldPath[] {
  return allFieldPaths(draft);
}

const WARNING_RULES: { test: RegExp; field: (draft: LineDraft) => FieldPath }[] = [
  { test: /how often|per day|times a day|frequency|how many/i, field: () => 'dosesPerDay' },
  { test: /strength|\bmg\b|\bmcg\b|unit/i, field: (d) => ingredientPath(d.ingredients[0].key, 'strength') },
  { test: /ingredient|composition|contains/i, field: (d) => ingredientPath(d.ingredients[0].key, 'name') },
  { test: /instruction|directions/i, field: () => 'instruction' },
  { test: /\bform\b|tablet|capsule|syrup/i, field: () => 'form' },
  { test: /name|product|brand|drug reference/i, field: () => 'productName' },
];

/** Puts each warning under the field it is about; anything unmatched goes to 'general'. */
export function warningsByField(warnings: string[], draft: LineDraft): Record<FieldPath | 'general', string[]> {
  const out: Record<string, string[]> = {};
  for (const w of warnings) {
    const rule = WARNING_RULES.find((r) => r.test.test(w));
    const key = rule ? rule.field(draft) : 'general';
    (out[key] ??= []).push(w);
  }
  return out;
}

/** Input id for a field of one line; `idPrefix` is unique per line on the page. */
export function lineFieldId(idPrefix: string, path: FieldPath): string {
  return `${idPrefix}-${path.replace(/\./g, '-')}`;
}
