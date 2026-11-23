// Values and checks for the medicine form (MedicineForm.tsx). Pure, unit-tested.
import type { DoseUnit, MedicineForm as Form, RoutineMedicineInput } from '../../../contract/types';

export interface IngredientRow { name: string; strength: string; unit: DoseUnit }

export interface MedicineValues {
  productName: string;
  ingredients: IngredientRow[];
  form: Form;
  dosesPerDay: string;
  instruction: string;
}

export type MedicineErrors = Partial<Record<'productName' | 'dosesPerDay' | 'instruction', string>> & { ingredients?: Record<number, { name?: string; strength?: string }> };

export const UNITS: DoseUnit[] = ['mg', 'mcg', 'g', 'ml', 'IU'];
export const FORMS: { value: Form; label: string }[] = [
  { value: 'tablet', label: 'Tablet' }, { value: 'capsule', label: 'Capsule' }, { value: 'syrup', label: 'Syrup' }, { value: 'other', label: 'Other' },
];

export const EMPTY_MEDICINE: MedicineValues = { productName: '', ingredients: [{ name: '', strength: '', unit: 'mg' }], form: 'tablet', dosesPerDay: '', instruction: '' };

export function valuesFrom(m: RoutineMedicineInput): MedicineValues {
  return {
    productName: m.productName,
    ingredients: m.ingredients.length ? m.ingredients.map((i) => ({ name: i.name, strength: String(i.strength), unit: i.unit })) : EMPTY_MEDICINE.ingredients,
    form: m.form, dosesPerDay: m.dosesPerDay === null ? '' : String(m.dosesPerDay), instruction: m.instruction,
  };
}

const num = (s: string) => Number(s.trim().replace(',', '.'));

/** Errors per field, and the input to save when there are none. An ingredient row left fully empty is dropped. */
export function validateMedicine(v: MedicineValues): { errors: MedicineErrors; input: RoutineMedicineInput | null } {
  const errors: MedicineErrors = {};
  const name = v.productName.trim().replace(/\s+/g, ' ');
  if (!name) errors.productName = 'Please enter the medicine name, as on the pack.';
  else if (name.length > 80) errors.productName = 'Please use 80 characters or fewer.';
  const filled = (r: IngredientRow) => r.name.trim() !== '' || r.strength.trim() !== '';
  v.ingredients.forEach((r, i) => {
    if (!filled(r)) return;
    const e: { name?: string; strength?: string } = {};
    if (!r.name.trim()) e.name = 'Please enter the active ingredient, for example paracetamol.';
    if (!r.strength.trim() || !(num(r.strength) > 0)) e.strength = 'Please enter the strength as a number, like 650.';
    if (e.name || e.strength) (errors.ingredients ??= {})[i] = e;
  });
  const rows = v.ingredients.filter(filled);
  const doses = v.dosesPerDay.trim();
  if (doses && !(num(doses) > 0 && num(doses) <= 24)) errors.dosesPerDay = 'Please enter how many doses a day, like 1 or 3, or leave it empty.';
  if (v.instruction.trim().length > 120) errors.instruction = 'Please use 120 characters or fewer.';
  if (Object.keys(errors).length) return { errors, input: null };
  return {
    errors,
    input: {
      productName: name,
      ingredients: rows.map((r) => ({ name: r.name.trim().toLowerCase(), strength: num(r.strength), unit: r.unit })),
      form: v.form,
      dosesPerDay: doses ? num(doses) : null,
      instruction: v.instruction.trim().replace(/\s+/g, ' '),
    },
  };
}

