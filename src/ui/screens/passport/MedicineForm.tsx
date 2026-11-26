// The fields of a routine entry typed by the user: "Add a medicine he takes" and Edit (UI spec 4.8, 4.9).
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DoseUnit, MedicineForm as Form, RoutineMedicineInput } from '../../../contract/types';
import { FORMS, UNITS, validateMedicine } from './medicineValues';
import type { IngredientRow, MedicineErrors, MedicineValues } from './medicineValues';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';

export interface MedicineFormProps {
  initial: MedicineValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: RoutineMedicineInput) => void;
  onCancel: () => void;
}

export function MedicineForm({ initial, submitLabel, pending, onSubmit, onCancel }: MedicineFormProps) {
  const [v, setV] = useState<MedicineValues>(initial);
  const [errors, setErrors] = useState<MedicineErrors>({});
  const setRow = (i: number, patch: Partial<IngredientRow>) =>
    setV((x) => ({ ...x, ingredients: x.ingredients.map((r, n) => (n === i ? { ...r, ...patch } : r)) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateMedicine(v);
    setErrors(result.errors);
    if (!result.input) {
      const first = result.errors.productName ? 'med-name'
        : result.errors.ingredients ? `med-ingredient-${Object.keys(result.errors.ingredients)[0]}-${result.errors.ingredients[Number(Object.keys(result.errors.ingredients)[0])].name ? 'name' : 'strength'}`
          : result.errors.dosesPerDay ? 'med-doses' : 'med-instruction';
      document.getElementById(first)?.focus();
      return;
    }
    onSubmit(result.input);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <Field id="med-name" label="Medicine name" hint="As printed on the pack, for example Dolo 650." value={v.productName} onChange={(e) => setV({ ...v, productName: e.target.value })} error={errors.productName} autoComplete="off" />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold text-ink">Active ingredients</legend>
        <p className="text-secondary text-ink-3">From the composition line on the pack. Used to notice possible duplicates.</p>
        {v.ingredients.map((r, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_auto] sm:items-start">
            <Field id={`med-ingredient-${i}-name`} label={`Ingredient ${i + 1}`} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} error={errors.ingredients?.[i]?.name} autoComplete="off" />
            <Field id={`med-ingredient-${i}-strength`} label="Strength" inputMode="decimal" value={r.strength} onChange={(e) => setRow(i, { strength: e.target.value })} error={errors.ingredients?.[i]?.strength} autoComplete="off" />
            <Field as="select" label="Unit" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value as DoseUnit })} options={UNITS.map((u) => ({ value: u, label: u }))} />
            {v.ingredients.length > 1 && (
              <Button variant="quiet" size="sm" className="sm:mt-8" aria-label={`Remove ingredient ${i + 1}`} icon={<X aria-hidden className="size-4" />} onClick={() => setV({ ...v, ingredients: v.ingredients.filter((_, n) => n !== i) })}>
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button variant="quiet" size="sm" className="-ml-1 self-start" icon={<Plus aria-hidden className="size-4" />} onClick={() => setV({ ...v, ingredients: [...v.ingredients, { name: '', strength: '', unit: 'mg' }] })}>
          Add another ingredient
        </Button>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field as="select" label="Form" value={v.form} onChange={(e) => setV({ ...v, form: e.target.value as Form })} options={FORMS} />
        <Field id="med-doses" label="Doses a day (optional)" inputMode="decimal" value={v.dosesPerDay} onChange={(e) => setV({ ...v, dosesPerDay: e.target.value })} error={errors.dosesPerDay} autoComplete="off" />
        <Field id="med-instruction" label="How it is taken (optional)" hint="For example: 1 tablet, morning" value={v.instruction} onChange={(e) => setV({ ...v, instruction: e.target.value })} error={errors.instruction} autoComplete="off" />
      </div>
      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending}>{submitLabel}</Button>
      </div>
    </form>
  );
}
