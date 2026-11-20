import { useCallback, useMemo, useState } from 'react';
import type { DoseUnit, ExtractedLine, MedicineForm } from '../../../contract/legacy/types';
import { allFieldPaths, draftFromLine, ingredientPath, newIngredientKey, validateDraft, warningsByField } from './lineDraft';
import type { FieldPath, LineDraft, LineErrors } from './lineDraft';

export interface LineDraftState {
  draft: LineDraft;
  /** Fields that came from extraction and are not yet edited or confirmed ("Check this"). */
  unchecked: ReadonlySet<FieldPath>;
  errors: LineErrors;
  warnings: Record<string, string[]>;
  setText: (path: 'productName' | 'dosesPerDay' | 'instruction', value: string) => void;
  setForm: (value: MedicineForm) => void;
  setIngredient: (key: string, part: 'name' | 'strength' | 'unit', value: string) => void;
  addIngredient: () => void;
  removeIngredient: (key: string) => void;
  /** The caregiver checked everything against the original: clears every marker. */
  confirmAll: () => void;
  /** Validates; shows errors and returns null when something is wrong. */
  submit: () => ExtractedLine | null;
}

/** State for one editable line. `fromExtraction` marks every field "Check this" until touched. */
export function useLineDraft(initial: ExtractedLine, fromExtraction: boolean): LineDraftState {
  // Build the first draft once, so the "Check this" paths use the same ingredient keys as the draft.
  const [first] = useState(() => {
    const d = draftFromLine(initial);
    return { draft: d, unchecked: fromExtraction ? new Set(allFieldPaths(d)) : new Set<FieldPath>() };
  });
  const [draft, setDraft] = useState<LineDraft>(first.draft);
  const [unchecked, setUnchecked] = useState<ReadonlySet<FieldPath>>(first.unchecked);
  const [errors, setErrors] = useState<LineErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const warnings = useMemo(() => warningsByField(initial.warnings, draft), [initial.warnings, draft]);

  const touch = useCallback((path: FieldPath) => {
    setUnchecked((set) => {
      if (!set.has(path)) return set;
      const next = new Set(set);
      next.delete(path);
      return next;
    });
  }, []);

  const apply = useCallback(
    (next: LineDraft, path: FieldPath) => {
      setDraft(next);
      touch(path);
      if (submitted) setErrors(validateDraft(next).errors);
    },
    [touch, submitted],
  );

  return {
    draft,
    unchecked,
    errors,
    warnings,
    setText: (path, value) => apply({ ...draft, [path]: value }, path),
    setForm: (value) => apply({ ...draft, form: value }, 'form'),
    setIngredient: (key, part, value) =>
      apply(
        {
          ...draft,
          ingredients: draft.ingredients.map((i) =>
            i.key === key ? { ...i, [part]: part === 'unit' ? (value as DoseUnit) : value } : i,
          ),
        },
        ingredientPath(key, part),
      ),
    addIngredient: () =>
      setDraft((d) => ({ ...d, ingredients: [...d.ingredients, { key: newIngredientKey(), name: '', strength: '', unit: 'mg' }] })),
    removeIngredient: (key) => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((i) => i.key !== key) })),
    confirmAll: () => setUnchecked(new Set()),
    submit: () => {
      setSubmitted(true);
      const result = validateDraft(draft);
      setErrors(result.errors);
      return result.line;
    },
  };
}
