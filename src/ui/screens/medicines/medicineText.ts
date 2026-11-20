// Wording for the Medicines screens. Pure functions, unit-tested.
import type { DocumentRecord, ISODate, Medicine, MedicationEvent, MedicineForm, Prescriber } from '../../../contract/legacy/types';
import { capitalize, strengthText } from '../../components/lineText';
import { formatDate, formatShortDate } from '../../lib/format';
import { shortDoctorName } from '../review/copy';

const FORM_UNIT: Record<MedicineForm, [string, string]> = {
  tablet: ['tablet', 'tablets'],
  capsule: ['capsule', 'capsules'],
  syrup: ['dose', 'doses'],
  other: ['dose', 'doses'],
};

export function formUnit(form: MedicineForm, n = 1): string {
  return n === 1 ? FORM_UNIT[form][0] : FORM_UNIT[form][1];
}

/** 'Paracetamol 650 mg per tablet' */
export function strengthPerUnit(m: Pick<Medicine, 'ingredients' | 'form'>): string {
  return `${m.ingredients.map((i, n) => `${n === 0 ? capitalize(i.name) : i.name} ${i.strength} ${i.unit}`).join(' + ')} per ${formUnit(m.form)}`;
}

/** 'Entered: 3 tablets a day' or 'How often: not entered' */
export function dosesText(m: Pick<Medicine, 'dosesPerDay' | 'form'>): string {
  return m.dosesPerDay === null ? 'How often: not entered' : `Entered: ${m.dosesPerDay} ${formUnit(m.form, m.dosesPerDay)} a day`;
}

export const STATUS_PHRASE: Record<Medicine['status'], string> = {
  found_at_home: 'found at home',
  confirmed_current: 'confirmed',
  needs_confirmation: 'needs confirmation',
  stopped: 'stopped',
};

export interface LastChange {
  kind: 'changed' | 'added' | 'none';
  text: string;
}

/**
 * The "Last change" column: a pill for a change on or after `since` (the last visit's
 * prescription date), otherwise "No change since <date>".
 */
export function lastChange(events: MedicationEvent[], since: ISODate | null): LastChange {
  const relevant = events
    .filter((e) => e.type === 'added' || e.type === 'strength_changed' || e.type === 'instruction_changed' || e.type === 'confirmed')
    .sort((a, b) => b.at.localeCompare(a.at));
  const e = relevant[0];
  if (!e) return { kind: 'none', text: 'No changes recorded' };
  const date = e.at.slice(0, 10);
  if (since && date >= since) {
    if (e.type === 'strength_changed' || e.type === 'instruction_changed') return { kind: 'changed', text: `${e.detail}, ${formatShortDate(date)}` };
    if (e.type === 'added') return { kind: 'added', text: `Added ${formatShortDate(date)}` };
  }
  return { kind: 'none', text: `No change since ${formatShortDate(date)}` };
}

/** "not on Dr. Rao's prescription of 28 Oct" for a medicine missing from its prescriber's latest prescription. */
export function missingFromText(m: Medicine, prescribers: Prescriber[], documents: DocumentRecord[]): string | null {
  if (!m.prescriberId) return null;
  const latest = documents
    .filter((d) => d.type === 'prescription' && d.prescriberId === m.prescriberId)
    .sort((a, b) => b.documentDate.localeCompare(a.documentDate))[0];
  const prescriber = prescribers.find((p) => p.id === m.prescriberId);
  if (!latest || !prescriber || latest.id === m.sourceDocumentId) return null;
  return `not on ${shortDoctorName(prescriber.name)}'s prescription of ${formatShortDate(latest.documentDate)}`;
}

/** 'Replaced by the 10 mg strength on 28 Oct 2026' or 'Marked stopped by you on 5 Aug 2026'. */
export function stoppedText(m: Medicine, all: Medicine[]): string {
  const when = formatDate(m.updatedAt);
  const replacement = m.replacedByMedicineId ? all.find((x) => x.id === m.replacedByMedicineId) : undefined;
  if (replacement) {
    const sameIngredients =
      replacement.ingredients.map((i) => i.name).sort().join() === m.ingredients.map((i) => i.name).sort().join();
    return sameIngredients
      ? `Replaced by the ${strengthText(replacement.ingredients)} strength on ${when}`
      : `Replaced by ${replacement.productName} on ${when}`;
  }
  return `Marked stopped by you on ${when}`;
}

export const EVENT_TITLE: Record<MedicationEvent['type'], string> = {
  added: 'Added',
  confirmed: 'Confirmed by you',
  strength_changed: 'Strength changed',
  instruction_changed: 'Instructions changed',
  flagged_for_review: 'Flagged for review',
  marked_stopped: 'Marked as stopped',
  replaced: 'Replaced',
};
