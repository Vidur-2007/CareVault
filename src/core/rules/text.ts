// Small wording helpers for the sentences the rules produce. Dates are read from the
// text of the ISO string, so the time zone of the device never shifts the day.
import type { ISODate, ISODateTime } from '../../contract/legacy/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(iso: ISODate | ISODateTime): { year: number; month: number; day: number } {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

/** '2026-10-28' -> '28 Oct' */
export function shortDate(iso: ISODate | ISODateTime): string {
  const { month, day } = parts(iso);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/** '2026-10-28' -> '28 Oct 2026' */
export function mediumDate(iso: ISODate | ISODateTime): string {
  return `${shortDate(iso)} ${parts(iso).year}`;
}

/** '2026-10-28' -> '28 October' */
export function dayAndMonth(iso: ISODate | ISODateTime): string {
  const { month, day } = parts(iso);
  return `${day} ${MONTHS_LONG[month - 1]}`;
}

/** '2026-11-12' -> 'Thursday' */
export function weekday(iso: ISODate | ISODateTime): string {
  const { year, month, day } = parts(iso);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** ['a', 'b', 'c'] -> 'a, b and c' */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** 2 -> 'Two'; larger numbers stay as digits. */
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface Pronouns {
  subject: 'he' | 'she' | 'they';
  possessive: 'his' | 'her' | 'their';
  /** 'is' for he and she, 'are' for they. */
  be: 'is' | 'are';
}

// The same lists as the UI uses (src/ui/lib/pronouns.ts), so both sides word things alike.
const HE = new Set(['father', 'dad', 'husband', 'son', 'brother', 'grandfather', 'grandpa', 'uncle', 'father-in-law']);
const SHE = new Set(['mother', 'mom', 'mum', 'wife', 'daughter', 'sister', 'grandmother', 'grandma', 'aunt', 'mother-in-law']);

/** Derived only from the relation the caregiver typed. Anything unrecognised is 'they'. */
export function pronounsFor(relation: string | null | undefined): Pronouns {
  const r = (relation ?? '').trim().toLowerCase();
  if (HE.has(r)) return { subject: 'he', possessive: 'his', be: 'is' };
  if (SHE.has(r)) return { subject: 'she', possessive: 'her', be: 'is' };
  return { subject: 'they', possessive: 'their', be: 'are' };
}
