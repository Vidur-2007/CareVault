import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentType, ExtractionCandidate, Prescriber } from '../../../contract/legacy/types';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { DOCUMENT_TYPE_LABEL } from '../../lib/labels';
import { defaultTitle, looksLike, matchPrescriber, validateDetails } from './recordsText';
import type { DetailsErrors, DetailsValues } from './recordsText';

export interface RecordDetailsFormProps {
  fileName: string;
  candidate: ExtractionCandidate | null;
  /** Why nothing was read, when reading failed. */
  readNote?: string | null;
  prescribers: Prescriber[];
  today: string;
  onSubmit: (values: DetailsValues) => void;
}

const FIELD_IDS: Record<keyof DetailsValues, string> = {
  type: 'record-type',
  title: 'record-title',
  documentDate: 'record-date',
  prescriberId: 'record-prescriber',
};

/** "Looks like a prescription from Dr. X dated Y" with editable type, title, date and doctor. */
export function RecordDetailsForm({ fileName, candidate, readNote, prescribers, today, onSubmit }: RecordDetailsFormProps) {
  const matched = matchPrescriber(candidate?.prescriberName ?? null, prescribers);
  const initialType: DocumentType = candidate?.documentType ?? 'other';
  const [values, setValues] = useState<DetailsValues>(() => ({
    type: initialType,
    title: defaultTitle(initialType, matched, fileName),
    documentDate: candidate?.documentDate ?? '',
    prescriberId: matched?.id ?? '',
  }));
  // Fields filled from the reading keep "Check this" until edited.
  const [unchecked, setUnchecked] = useState<Set<keyof DetailsValues>>(() => {
    const set = new Set<keyof DetailsValues>();
    if (candidate) {
      set.add('type');
      if (candidate.documentDate) set.add('documentDate');
      if (matched) set.add('prescriberId');
    }
    return set;
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const sentence = looksLike(candidate);
  const unknownDoctor = candidate?.prescriberName && !matched ? candidate.prescriberName : null;
  const prescriberById = (id: string) => prescribers.find((p) => p.id === id) ?? null;

  const set = <K extends keyof DetailsValues>(key: K, value: DetailsValues[K]) => {
    const next = { ...values, [key]: value };
    // A title the caregiver never edited follows the type and doctor.
    if (values.title === defaultTitle(values.type, prescriberById(values.prescriberId), fileName)) {
      next.title = defaultTitle(next.type, prescriberById(next.prescriberId), fileName);
    }
    setValues(next);
    setUnchecked((u) => {
      const n = new Set(u);
      n.delete(key);
      return n;
    });
    if (submitted) setErrors(validateDetails(next, today));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const found = validateDetails(values, today);
    setErrors(found);
    const first = (Object.keys(FIELD_IDS) as (keyof DetailsValues)[]).find((k) => found[k]);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    onSubmit({ ...values, title: values.title.trim() });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      {sentence ? (
        <p className="rounded-panel bg-blue-tint px-4 py-3 font-semibold text-blue-ink">{sentence}</p>
      ) : (
        <p className="rounded-panel bg-surface-muted px-4 py-3 text-ink-2">
          {readNote ?? 'Nothing could be read automatically.'} Fill in the details from the document.
        </p>
      )}
      <Field
        id={FIELD_IDS.type}
        label="Type"
        as="select"
        options={(Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[]).map((t) => ({ value: t, label: DOCUMENT_TYPE_LABEL[t] }))}
        value={values.type}
        onChange={(e) => set('type', e.target.value as DocumentType)}
        extracted={unchecked.has('type')}
      />
      <Field id={FIELD_IDS.title} label="Title" value={values.title} onChange={(e) => set('title', e.target.value)} error={errors.title} autoComplete="off" />
      <Field
        id={FIELD_IDS.documentDate}
        label="Date on the document"
        type="date"
        max={today}
        value={values.documentDate}
        onChange={(e) => set('documentDate', e.target.value)}
        extracted={unchecked.has('documentDate')}
        error={errors.documentDate}
      />
      <Field
        id={FIELD_IDS.prescriberId}
        label="Doctor"
        as="select"
        options={[{ value: '', label: 'Not from a doctor' }, ...prescribers.map((p) => ({ value: p.id, label: `${p.name}, ${p.specialty.toLowerCase()}` }))]}
        value={values.prescriberId}
        onChange={(e) => set('prescriberId', e.target.value)}
        extracted={unchecked.has('prescriberId')}
        hint={unknownDoctor ? `“${unknownDoctor}” was read from the document but is not one of this profile’s doctors.` : undefined}
        error={errors.prescriberId}
      />
      <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
        <Button type="submit">{values.type === 'prescription' ? 'Save and check the medicines' : 'Save to records'}</Button>
      </div>
    </form>
  );
}
