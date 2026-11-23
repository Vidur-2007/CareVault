// Wording and ordering for the Passport and the medicine detail (UI spec 4.8, 4.9). Pure, unit-tested.
import type {
  DocumentRecord, HealthEntry, MedicineForm, PassportSnapshot, Prescriber, Profile, RoutineEvent, RoutineEventType, RoutineMedicine, Visit,
} from '../../../contract/types';
import type { PillSpec } from '../../components/pills';
import { capitalize } from '../../components/lineText';
import { formatDate, formatShortDate } from '../../lib/format';
import { pronounsFor, verb } from '../../lib/pronouns';

/** Overview section 9.5: the fixed sentence under every possible duplicate. */
export const DUPLICATE_SENTENCE = 'These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.';

export const isSelf = (p: Pick<Profile, 'relation'>) => p.relation === 'Myself';

/** "he takes", "she takes", "they take", or "I take" for the patient's own profile. */
export function takes(p: Pick<Profile, 'relation'>): string {
  if (isSelf(p)) return 'I take';
  const they = pronounsFor(p.relation);
  return `${they.subject} ${verb(they, 'take')}`;
}

/** "he still takes", "I still take". */
export function stillTakes(p: Pick<Profile, 'relation'>): string {
  if (isSelf(p)) return 'I still take';
  const they = pronounsFor(p.relation);
  return `${they.subject} still ${verb(they, 'take')}`;
}

/** "Reported by Anjali", "From a prescription", "From the pack". */
export function sourceLabel(m: Pick<RoutineMedicine, 'source'>, profile: Pick<Profile, 'name' | 'caregiverName'>): string {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? '';
  switch (m.source) {
    case 'caregiver_reported': return profile.caregiverName ? `Reported by ${first(profile.caregiverName)}` : 'Reported by the caregiver';
    case 'patient_reported': return `Reported by ${first(profile.name)}`;
    case 'from_prescription': return 'From a prescription';
    case 'from_pack': return 'From the pack';
    default: return 'From the earlier version of CareVault';
  }
}

/** UI spec section 2, the status pills. */
export function statusPill(m: Pick<RoutineMedicine, 'status' | 'replacedByMedicineId' | 'legacyReviewPending'>): PillSpec {
  if (m.legacyReviewPending && m.status !== 'stopped') return { tone: 'amber', label: 'Previously listed' };
  switch (m.status) {
    case 'taking': return { tone: 'teal', label: 'Taking' };
    case 'uncertain': return { tone: 'amber', label: 'Current use not confirmed' };
    case 'not_started': return { tone: 'grey', label: 'Not started' };
    default: return { tone: 'grey', label: m.replacedByMedicineId ? 'Replaced' : 'Stopped' };
  }
}

export const lastConfirmedText = (m: Pick<RoutineMedicine, 'lastConfirmedAt'>) =>
  m.lastConfirmedAt ? `Last confirmed ${formatShortDate(m.lastConfirmedAt)}` : 'Not confirmed yet';

export const ingredientsText = (m: Pick<RoutineMedicine, 'ingredients'>) =>
  m.ingredients.length ? m.ingredients.map((i, n) => `${n === 0 ? capitalize(i.name) : i.name} ${i.strength} ${i.unit}`).join(' + ') : 'Active ingredient not entered';

const FORM_UNIT: Record<MedicineForm, [string, string]> = {
  tablet: ['tablet', 'tablets'], capsule: ['capsule', 'capsules'], syrup: ['dose', 'doses'], other: ['dose', 'doses'],
};

/** "1 tablet, morning" or "3 tablets a day" or "How often: not entered". */
export function howTaken(m: Pick<RoutineMedicine, 'instruction' | 'dosesPerDay' | 'form'>): string {
  if (m.instruction) return m.instruction;
  if (m.dosesPerDay === null) return 'How often: not entered';
  return `${m.dosesPerDay} ${FORM_UNIT[m.form][m.dosesPerDay === 1 ? 0 : 1]} a day`;
}

/**
 * Current medicines in the passport order (overview 9.6): the next visit's prescriber first, then
 * other prescribers by name, then no prescriber; by product name within each group.
 */
export function currentOrder(routine: RoutineMedicine[], visit: Pick<Visit, 'prescriberId'> | null, prescribers: Prescriber[]): RoutineMedicine[] {
  const group = (m: RoutineMedicine) => {
    if (visit && m.prescriberId === visit.prescriberId) return '0';
    const p = prescribers.find((x) => x.id === m.prescriberId);
    return p ? `1 ${p.name.toLowerCase()}` : '2';
  };
  return routine
    .filter((m) => m.status === 'taking' && !m.legacyReviewPending)
    .sort((a, b) => group(a).localeCompare(group(b)) || a.productName.localeCompare(b.productName));
}

/** "Current use not confirmed": uncertain entries and legacy entries still pending. */
export const unconfirmedOf = (routine: RoutineMedicine[]) =>
  routine
    .filter((m) => m.status !== 'stopped' && (m.status === 'uncertain' || m.legacyReviewPending))
    .sort((a, b) => a.productName.localeCompare(b.productName));

export type AllergyState = { state: 'listed'; items: HealthEntry[] } | { state: 'none_known'; entry: HealthEntry } | { state: 'not_recorded' };

export function allergyState(health: HealthEntry[]): AllergyState {
  const allergies = health.filter((h) => h.kind === 'allergy');
  const none = allergies.find((h) => h.noneKnown);
  const listed = allergies.filter((h) => !h.noneKnown);
  if (listed.length) return { state: 'listed', items: listed };
  if (none) return { state: 'none_known', entry: none };
  return { state: 'not_recorded' };
}

const SNAPSHOT_REASON: Record<PassportSnapshot['reason'], string> = { manual: 'saved', print: 'printed', share: 'shared' };

/** "Passport 3 · 14 Nov 2026 · printed": the date the passport was prepared, from todayFor, as printed on it. */
export const snapshotLine = (s: Pick<PassportSnapshot, 'revision' | 'reason'> & { passport: Pick<PassportSnapshot['passport'], 'preparedOn'> }) =>
  `Passport ${s.revision} · ${formatDate(s.passport.preparedOn)} · ${SNAPSHOT_REASON[s.reason]}`;

// ---------- history ----------

const EVENT_LABEL: Record<RoutineEventType, string> = {
  added: 'Added', confirmed: 'Confirmed', changed: 'Changed', not_started: 'Not started', stopped: 'Stopped',
  restarted: 'Taking again', marked_uncertain: 'Marked as not sure', replaced: 'Replaced', undone: 'Undone', migrated: 'Brought over',
};

export const eventLabel = (e: Pick<RoutineEvent, 'type'>) => EVENT_LABEL[e.type];

const STATUS_WORD: Record<RoutineMedicine['status'], string> = {
  taking: 'taking', uncertain: 'not confirmed', not_started: 'not started', stopped: 'stopped',
};

/** The before-and-after of one event, field by field: [{ label, before, after }]. */
export function eventChanges(e: Pick<RoutineEvent, 'before' | 'after'>): { label: string; before: string; after: string }[] {
  const { before, after } = e;
  if (!before || !after) return [];
  const rows: { label: string; before: string; after: string }[] = [];
  const add = (label: string, b: string, a: string) => {
    if (b !== a) rows.push({ label, before: b, after: a });
  };
  add('Name', before.productName, after.productName);
  add('Strength', ingredientsText(before), ingredientsText(after));
  add('Doses a day', before.dosesPerDay === null ? 'not entered' : String(before.dosesPerDay), after.dosesPerDay === null ? 'not entered' : String(after.dosesPerDay));
  add('How it is taken', before.instruction || 'not entered', after.instruction || 'not entered');
  add('Status', STATUS_WORD[before.status], STATUS_WORD[after.status]);
  return rows;
}

/** The event that Undo applies to: the latest one (history is oldest first), unless it is itself an undo. */
export function undoable(events: RoutineEvent[]): RoutineEvent | null {
  const latest = events.at(-1);
  if (!latest || latest.type === 'undone' || latest.type === 'migrated') return null;
  return events.some((e) => e.undoesEventId === latest.id) ? null : latest;
}

/** Filed records that can go with the passport: starred first, then newest. Pack photos are left out (request v2-3). */
export function shareableReports(docs: DocumentRecord[]): DocumentRecord[] {
  const isPackPhoto = (d: DocumentRecord) => d.kind === 'other' && d.mimeType.startsWith('image/');
  return docs
    .filter((d) => d.state === 'filed' && !isPackPhoto(d))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || (b.clinicalDate ?? '').localeCompare(a.clinicalDate ?? '') || b.addedAt.localeCompare(a.addedAt));
}
