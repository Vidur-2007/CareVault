import type { Profile } from '../../../contract/legacy/types';

export interface ProfileFormValues {
  name: string;
  relation: string;
  birthYear: string;
  caregiverName: string;
  caregiverRelation: string;
}

export type ProfileFormErrors = Partial<Record<keyof ProfileFormValues, string>>;

export const EMPTY_PROFILE_FORM: ProfileFormValues = { name: '', relation: '', birthYear: '', caregiverName: '', caregiverRelation: '' };

/** Field order, used to focus the first field with an error. */
export const PROFILE_FIELD_ORDER: (keyof ProfileFormValues)[] = ['name', 'relation', 'birthYear', 'caregiverName', 'caregiverRelation'];

const MAX = 60;

const REQUIRED: Record<Exclude<keyof ProfileFormValues, 'birthYear'>, string> = {
  name: 'Please enter their name.',
  relation: 'Please enter how they are related to you, for example Father.',
  caregiverName: 'Please enter your name.',
  caregiverRelation: 'Please enter your relation to them, for example daughter.',
};

/** Returns errors per field, and the profile to create when there are none. */
export function validateProfile(
  values: ProfileFormValues,
  currentYear: number,
): { errors: ProfileFormErrors; profile: Omit<Profile, 'id' | 'createdAt'> | null } {
  const errors: ProfileFormErrors = {};
  const trimmed = {
    name: values.name.trim().replace(/\s+/g, ' '),
    relation: values.relation.trim().replace(/\s+/g, ' '),
    caregiverName: values.caregiverName.trim().replace(/\s+/g, ' '),
    caregiverRelation: values.caregiverRelation.trim().replace(/\s+/g, ' '),
  };

  for (const key of Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]) {
    if (!trimmed[key]) errors[key] = REQUIRED[key];
    else if (trimmed[key].length > MAX) errors[key] = `Please use ${MAX} characters or fewer.`;
  }

  let birthYear: number | null = null;
  const year = values.birthYear.trim();
  if (year) {
    const n = Number(year);
    if (!/^\d{4}$/.test(year) || n < 1900 || n > currentYear) {
      errors.birthYear = `Please enter a year between 1900 and ${currentYear}, like 1955, or leave it empty.`;
    } else {
      birthYear = n;
    }
  }

  if (Object.keys(errors).length > 0) return { errors, profile: null };
  return {
    errors,
    profile: {
      name: trimmed.name,
      relation: trimmed.relation[0].toUpperCase() + trimmed.relation.slice(1),
      birthYear,
      caregiverName: trimmed.caregiverName,
      caregiverRelation: trimmed.caregiverRelation.toLowerCase(),
    },
  };
}
