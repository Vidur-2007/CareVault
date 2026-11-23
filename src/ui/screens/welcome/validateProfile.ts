import type { Profile } from '../../../contract/types';

export interface ProfileFormValues {
  /** "I manage my own records": no caregiver, relation "Myself". */
  selfManaged: boolean;
  name: string;
  relation: string;
  birthYear: string;
  emergencyContact: string;
  caregiverName: string;
  caregiverRelation: string;
}

type TextField = Exclude<keyof ProfileFormValues, 'selfManaged'>;
export type ProfileFormErrors = Partial<Record<TextField, string>>;
export type NewProfile = Omit<Profile, 'id' | 'createdAt'>;

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  selfManaged: false, name: '', relation: '', birthYear: '', emergencyContact: '', caregiverName: '', caregiverRelation: '',
};

/** Field order on screen, used to focus the first field with an error. */
export const PROFILE_FIELD_ORDER: TextField[] = ['name', 'relation', 'birthYear', 'emergencyContact', 'caregiverName', 'caregiverRelation'];

const MAX = 60;
const MAX_CONTACT = 100;
export const SELF_RELATION = 'Myself';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Returns errors per field, and the profile to create when there are none. */
export function validateProfile(values: ProfileFormValues, currentYear: number): { errors: ProfileFormErrors; profile: NewProfile | null } {
  const errors: ProfileFormErrors = {};
  const self = values.selfManaged;
  const v = {
    name: clean(values.name),
    relation: clean(values.relation),
    emergencyContact: clean(values.emergencyContact),
    caregiverName: clean(values.caregiverName),
    caregiverRelation: clean(values.caregiverRelation),
  };

  const required: Partial<Record<TextField, string>> = self
    ? { name: 'Please enter your name.' }
    : {
      name: 'Please enter their name.',
      relation: 'Please enter how they are related to you, for example Father.',
      caregiverName: 'Please enter your name.',
      caregiverRelation: 'Please enter your relation to them, for example daughter.',
    };
  for (const [key, message] of Object.entries(required) as [keyof typeof v, string][]) {
    if (!v[key]) errors[key] = message;
    else if (v[key].length > MAX) errors[key] = `Please use ${MAX} characters or fewer.`;
  }
  if (v.emergencyContact.length > MAX_CONTACT) errors.emergencyContact = `Please use ${MAX_CONTACT} characters or fewer.`;

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
      name: v.name,
      relation: self ? SELF_RELATION : v.relation[0].toUpperCase() + v.relation.slice(1),
      birthYear,
      caregiverName: self ? '' : v.caregiverName,
      caregiverRelation: self ? '' : v.caregiverRelation.toLowerCase(),
      emergencyContact: v.emergencyContact || null,
    },
  };
}

/** The form values of an existing profile, for editing it (UI spec 4.13). */
export function valuesFromProfile(p: Profile): ProfileFormValues {
  const self = p.relation === SELF_RELATION;
  return {
    selfManaged: self,
    name: p.name,
    relation: self ? '' : p.relation,
    birthYear: p.birthYear === null ? '' : String(p.birthYear),
    emergencyContact: p.emergencyContact ?? '',
    caregiverName: p.caregiverName,
    caregiverRelation: p.caregiverRelation,
  };
}
