import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../Button';
import { Field } from '../Field';
import { DOSE_UNITS, MEDICINE_FORMS, ingredientPath, lineFieldId } from './lineDraft';
import type { MedicineForm } from '../../../contract/legacy/types';
import type { LineDraftState } from './useLineDraft';

export interface LineFieldsProps {
  state: LineDraftState;
  /** Prefix for input ids, unique per line on the page. */
  idPrefix: string;
  disabled?: boolean;
  /** Hint under the product name, e.g. 'As written on the prescription'. */
  nameHint?: string;
}

/** The editable fields of one line. Extracted fields carry "Check this" until edited or confirmed. */
export function LineFields({ state, idPrefix, disabled = false, nameHint = 'As printed on the pack' }: LineFieldsProps) {
  const { draft, unchecked, errors, warnings } = state;
  const id = (path: string) => lineFieldId(idPrefix, path);

  return (
    <div className="flex flex-col gap-5">
      {warnings.general && warnings.general.length > 0 && (
        <ul className="rounded-panel bg-amber-tint px-4 py-3 text-secondary text-amber-ink">
          {warnings.general.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Field
        id={id('productName')}
        label="Product name"
        hint={nameHint}
        value={draft.productName}
        onChange={(e) => state.setText('productName', e.target.value)}
        extracted={unchecked.has('productName')}
        warnings={warnings.productName}
        error={errors.productName}
        disabled={disabled}
        autoComplete="off"
      />

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold text-ink">Active ingredients</legend>
        {draft.ingredients.map((ing, index) => (
          <div key={ing.key} className="rounded-panel border border-line bg-surface-muted p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id={id(ingredientPath(ing.key, 'name'))}
                className="sm:col-span-2"
                label={draft.ingredients.length > 1 ? `Ingredient ${index + 1}` : 'Ingredient'}
                value={ing.name}
                onChange={(e) => state.setIngredient(ing.key, 'name', e.target.value)}
                extracted={unchecked.has(ingredientPath(ing.key, 'name'))}
                warnings={warnings[ingredientPath(ing.key, 'name')]}
                error={errors[ingredientPath(ing.key, 'name')]}
                disabled={disabled}
                autoComplete="off"
              />
              <Field
                id={id(ingredientPath(ing.key, 'strength'))}
                label="Strength"
                inputMode="decimal"
                value={ing.strength}
                onChange={(e) => state.setIngredient(ing.key, 'strength', e.target.value)}
                extracted={unchecked.has(ingredientPath(ing.key, 'strength'))}
                warnings={warnings[ingredientPath(ing.key, 'strength')]}
                error={errors[ingredientPath(ing.key, 'strength')]}
                disabled={disabled}
                autoComplete="off"
              />
              <Field
                id={id(ingredientPath(ing.key, 'unit'))}
                label="Unit"
                as="select"
                options={DOSE_UNITS.map((u) => ({ value: u, label: u }))}
                value={ing.unit}
                onChange={(e) => state.setIngredient(ing.key, 'unit', e.target.value)}
                extracted={unchecked.has(ingredientPath(ing.key, 'unit'))}
                disabled={disabled}
              />
            </div>
            {draft.ingredients.length > 1 && (
              <Button
                variant="quiet"
                size="sm"
                className="mt-2"
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => state.removeIngredient(ing.key)}
                disabled={disabled}
                aria-label={`Remove ${ing.name || `ingredient ${index + 1}`}`}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button variant="quiet" className="self-start" icon={<Plus aria-hidden className="size-5" />} onClick={state.addIngredient} disabled={disabled}>
          Add another ingredient
        </Button>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={id('form')}
          label="Form"
          as="select"
          options={MEDICINE_FORMS}
          value={draft.form}
          onChange={(e) => state.setForm(e.target.value as MedicineForm)}
          extracted={unchecked.has('form')}
          warnings={warnings.form}
          disabled={disabled}
        />
        <Field
          id={id('dosesPerDay')}
          label="How many per day"
          hint="Leave empty if you do not know."
          inputMode="decimal"
          value={draft.dosesPerDay}
          onChange={(e) => state.setText('dosesPerDay', e.target.value)}
          extracted={unchecked.has('dosesPerDay')}
          warnings={warnings.dosesPerDay}
          error={errors.dosesPerDay}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      <Field
        id={id('instruction')}
        label="How it is taken"
        hint="For example: 1 tablet, morning"
        value={draft.instruction}
        onChange={(e) => state.setText('instruction', e.target.value)}
        extracted={unchecked.has('instruction')}
        warnings={warnings.instruction}
        error={errors.instruction}
        disabled={disabled}
        autoComplete="off"
      />
    </div>
  );
}
