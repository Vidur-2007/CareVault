// Edit a record's details (UI spec 4.5). A date typed here becomes "Date set by you".
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentRecord } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { useProfile } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { KIND_LABEL, KIND_ORDER } from '../../lib/labels';
import { detailsFrom, detailsPatch, validateDetails } from './recordsText';
import type { DetailsErrors, DetailsValues } from './recordsText';

const ORDER: (keyof DetailsValues)[] = ['kind', 'title', 'clinicalDate', 'prescriberId', 'facility', 'testNames', 'tags'];
const fieldId = (key: keyof DetailsValues) => `record-${key}`;

export function EditDetailsDialog({ doc, open, onClose }: { doc: DocumentRecord; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit the details" size="lg">
      {/* Remounted on each open, so the form starts from the saved record. */}
      {open && <DetailsForm doc={doc} onDone={onClose} />}
    </Dialog>
  );
}

function DetailsForm({ doc, onDone }: { doc: DocumentRecord; onDone: () => void }) {
  const { prescribers, today } = useProfile();
  const [values, setValues] = useState<DetailsValues>(() => detailsFrom(doc));
  const [errors, setErrors] = useState<DetailsErrors>({});
  const save = useServiceAction((s, patch: ReturnType<typeof detailsPatch>) => s.documents.update(doc.id, patch), {
    success: 'Details saved',
    errorPrefix: 'The details could not be saved',
  });
  const set = (key: keyof DetailsValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateDetails(values, today);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    const patch = detailsPatch(doc, values);
    if (Object.keys(patch).length === 0) return onDone();
    if (await save.run(patch)) onDone();
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fieldId('kind')}
          as="select"
          label="Kind"
          value={values.kind}
          onChange={set('kind')}
          options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
        <Field id={fieldId('title')} label="Title" value={values.title} onChange={set('title')} error={errors.title} autoComplete="off" />
        <Field
          id={fieldId('clinicalDate')}
          type="date"
          label="Date on the document"
          hint="Leave it empty when the document shows no date."
          max={today}
          value={values.clinicalDate}
          onChange={set('clinicalDate')}
          error={errors.clinicalDate}
        />
        <Field
          id={fieldId('prescriberId')}
          as="select"
          label="Doctor"
          value={values.prescriberId}
          onChange={set('prescriberId')}
          options={[{ value: '', label: 'No doctor' }, ...prescribers.map((p) => ({ value: p.id, label: p.specialty ? `${p.name}, ${p.specialty}` : p.name }))]}
        />
        <Field id={fieldId('facility')} label="Facility (optional)" hint="The lab, clinic or hospital, as printed." value={values.facility} onChange={set('facility')} error={errors.facility} autoComplete="off" />
        <Field id={fieldId('testNames')} label="Tests (optional)" hint="Separate them with commas: Lipid profile, HbA1c" value={values.testNames} onChange={set('testNames')} autoComplete="off" />
        <Field id={fieldId('tags')} label="Labels (optional)" hint="Separate them with commas: blood test, cardiology" value={values.tags} onChange={set('tags')} autoComplete="off" className="sm:col-span-2" />
      </div>
      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={save.pending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.pending}>
          Save the details
        </Button>
      </div>
    </form>
  );
}
