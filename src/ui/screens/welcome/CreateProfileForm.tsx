import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Profile } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Field } from '../../components/Field';
import { useServiceAction } from '../../hooks/useServiceAction';
import { EMPTY_PROFILE_FORM, PROFILE_FIELD_ORDER, validateProfile } from './validateProfile';
import type { NewProfile, ProfileFormErrors, ProfileFormValues } from './validateProfile';

type TextField = Exclude<keyof ProfileFormValues, 'selfManaged'>;
const fieldId = (key: TextField) => `profile-${key}`;

export interface CreateProfileFormProps {
  onCreated: (profile: Profile) => void;
  onCancel?: () => void;
}

/** Create-profile form (UI spec 4.1). Errors appear on submit, then update as the user types. */
export function CreateProfileForm({ onCreated, onCancel }: CreateProfileFormProps) {
  const [values, setValues] = useState<ProfileFormValues>(EMPTY_PROFILE_FORM);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const create = useServiceAction((s, input: NewProfile) => s.profiles.create(input), {
    errorPrefix: 'The profile could not be created',
  });
  const currentYear = new Date().getFullYear();
  const self = values.selfManaged;

  useEffect(() => {
    document.getElementById(fieldId('name'))?.focus();
  }, []);

  const update = (next: ProfileFormValues) => {
    setValues(next);
    if (submitted) setErrors(validateProfile(next, currentYear).errors);
  };
  const set = (key: TextField) => (e: { target: { value: string } }) => update({ ...values, [key]: e.target.value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const result = validateProfile(values, currentYear);
    setErrors(result.errors);
    if (!result.profile) {
      const first = PROFILE_FIELD_ORDER.find((k) => result.errors[k]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    const profile = await create.run(result.profile);
    if (profile) onCreated(profile);
  };

  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby="create-profile-title" className="flex flex-col gap-5">
      <h2 id="create-profile-title" className="text-card-sm md:text-card">
        Create a profile
      </h2>
      <Checkbox
        label="I manage my own records"
        description="For your own medicines and records. The caregiver details are left out."
        checked={self}
        onChange={(e) => update({ ...values, selfManaged: e.target.checked })}
      />
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 font-semibold text-ink-3">{self ? 'You' : 'The person you care for'}</legend>
        <Field
          id={fieldId('name')}
          label={self ? 'Your name' : 'Name'}
          autoComplete={self ? 'name' : 'off'}
          value={values.name}
          onChange={set('name')}
          error={errors.name}
        />
        {!self && (
          <Field
            id={fieldId('relation')}
            label="Relation to you"
            hint="For example: Father"
            autoComplete="off"
            value={values.relation}
            onChange={set('relation')}
            error={errors.relation}
          />
        )}
        <Field
          id={fieldId('birthYear')}
          label="Birth year (optional)"
          hint="Used to show the age on the passport."
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          value={values.birthYear}
          onChange={set('birthYear')}
          error={errors.birthYear}
        />
        <Field
          id={fieldId('emergencyContact')}
          label="Emergency contact (optional)"
          hint="A name and phone number, for example: Anjali Iyer, +91 90000 00000. Shown on the passport."
          autoComplete="off"
          value={values.emergencyContact}
          onChange={set('emergencyContact')}
          error={errors.emergencyContact}
        />
      </fieldset>
      {!self && (
        <fieldset className="flex flex-col gap-5">
          <legend className="mb-1 font-semibold text-ink-3">You, the caregiver</legend>
          <Field
            id={fieldId('caregiverName')}
            label="Your name"
            hint='Shown as "Prepared by" on the passport.'
            autoComplete="name"
            value={values.caregiverName}
            onChange={set('caregiverName')}
            error={errors.caregiverName}
          />
          <Field
            id={fieldId('caregiverRelation')}
            label="Your relation to them"
            hint="For example: daughter"
            autoComplete="off"
            value={values.caregiverRelation}
            onChange={set('caregiverRelation')}
            error={errors.caregiverRelation}
          />
        </fieldset>
      )}
      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={create.pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={create.pending}>
          Create profile
        </Button>
      </div>
    </form>
  );
}
