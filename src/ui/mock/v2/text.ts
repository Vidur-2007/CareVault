// Small pure helpers for the v2 mock: matching, units, dates, names.
import type * as T from '../../../contract/types';

export const ACTIVE_FOR_REVIEW: T.RoutineStatus[] = ['taking', 'uncertain', 'not_started'];

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The set of normalized active ingredient names. Brand names are never used. '' when unknown. */
export function ingredientKey(ingredients: T.Ingredient[]): string {
  return [...new Set(ingredients.map((i) => norm(i.name)).filter(Boolean))].sort().join('+');
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

const MASS: Partial<Record<T.DoseUnit, number>> = { mcg: 0.001, mg: 1, g: 1000 };
export const isMass = (u: T.DoseUnit) => MASS[u] !== undefined;
export const toMg = (value: number, unit: T.DoseUnit) => round3(value * (MASS[unit] ?? 1));

function strengthSig(ingredients: T.Ingredient[]): string {
  return ingredients.map((i) => `${norm(i.name)}:${isMass(i.unit) ? `${toMg(i.strength, i.unit)}mg` : `${i.strength}${i.unit}`}`).sort().join('|');
}

type LineLike = Pick<T.PrescriptionLine, 'ingredients' | 'dosesPerDay' | 'form' | 'instruction'>;

export const strengthDiffers = (a: LineLike, b: LineLike) => strengthSig(a.ingredients) !== strengthSig(b.ingredients);

export const identical = (a: LineLike, b: LineLike) =>
  !strengthDiffers(a, b) && a.dosesPerDay === b.dosesPerDay && a.form === b.form && norm(a.instruction) === norm(b.instruction);

export const strengthText = (ingredients: T.Ingredient[]) => ingredients.map((i) => `${i.strength} ${i.unit}`).join(' + ');

/** '40 mg to 80 mg', or the instruction change. */
export function changeNote(from: LineLike, to: LineLike): string {
  if (strengthDiffers(from, to)) return `${strengthText(from.ingredients)} to ${strengthText(to.ingredients)}`;
  if (from.dosesPerDay !== to.dosesPerDay) return `${from.dosesPerDay ?? '?'} to ${to.dosesPerDay ?? '?'} a day`;
  return `"${from.instruction}" to "${to.instruction}"`;
}

export const firstWord = (s: string) => norm(s).split(' ')[0] ?? '';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-13' -> '13 Nov 2026'. Parsed by hand so the time zone never shifts the day. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The device's local date as YYYY-MM-DD. */
export function deviceToday(): T.ISODate {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Adds days to an ISO date (UTC arithmetic on the calendar date). */
export function addDays(iso: T.ISODate, days: number): T.ISODate {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Name comparison for patient match: case, titles, initials and word order are ignored. */
export function sameName(a: string, b: string): boolean {
  const words = (s: string) =>
    norm(s)
      .replace(/[.,]/g, ' ')
      .split(' ')
      .filter((w) => w && !['mr', 'mrs', 'ms', 'smt', 'shri', 'sri', 'dr', 'miss'].includes(w) && w.length > 1)
      .sort()
      .join(' ');
  return words(a) !== '' && words(a) === words(b);
}

export function patientMatch(read: string | null, profileName: string): T.DocumentRecord['patientMatch'] {
  if (!read) return 'not_found';
  return sameName(read, profileName) ? 'match' : 'mismatch';
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through: only where Web Crypto is missing
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + b, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.repeat(4);
}
