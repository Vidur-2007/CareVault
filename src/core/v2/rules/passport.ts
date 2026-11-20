// The live passport (overview 8.1, 9.6). Pure: computed from the stored state, never stored.
// Printing and sharing always freeze it into a snapshot first.
import type {
  DocumentRecord,
  HealthEntry,
  ID,
  ISODate,
  Ingredient,
  Passport,
  PassportSnapshot,
  Prescriber,
  Profile,
  RoutineEvent,
  RoutineMedicine,
  Visit,
} from '../../../contract/types';
import { DUPLICATE_WORDING, duplicateIngredientGroups, duplicateTitle } from './attention';

export const RECENT_DAYS = 90;

export const UNCONFIRMED_REASONS = {
  uncertain: 'Not confirmed as taken',
  legacy: 'Kept from the earlier version; not reviewed yet',
} as const;

export interface PassportInput {
  profile: Profile;
  today: ISODate;
  prescribers: readonly Prescriber[];
  routine: readonly RoutineMedicine[];
  events: readonly RoutineEvent[];
  health: readonly HealthEntry[];
  documents: readonly DocumentRecord[];
  /** The next visit, if any. */
  visit: Visit | null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const byName = (a: RoutineMedicine, b: RoutineMedicine) => a.productName.localeCompare(b.productName) || a.id.localeCompare(b.id);
/**
 * The calendar date the user would say. Times stored with an offset ('+05:30') already carry
 * it; times recorded on the device are UTC ('Z'), so they are read in the device's time zone.
 */
export function dateOf(iso: string): ISODate {
  if (!iso.endsWith('Z')) return iso.slice(0, 10);
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'Amlodipine 10 mg', or 'Paracetamol 500 mg + Caffeine 65 mg'. */
export function ingredientsText(ingredients: readonly Ingredient[]): string {
  return ingredients.map((i) => `${capitalize(i.name)} ${i.strength} ${i.unit}`).join(' + ');
}

export function daysBefore(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Changes the user recorded in the last 90 days, newest first. Undone changes are left out. */
export function recentChanges(events: readonly RoutineEvent[], routine: readonly RoutineMedicine[], today: ISODate): Passport['recentChanges'] {
  const since = daysBefore(today, RECENT_DAYS);
  const undone = new Set(events.filter((e) => e.type === 'undone').map((e) => e.undoesEventId));
  const live = events.filter((e) => e.type !== 'undone' && !undone.has(e.id));
  const names = new Map(routine.map((m) => [m.id, m.productName]));
  // The new half of a replacement is told together with the old half.
  const replacements = new Set(
    live.filter((e) => e.type === 'replaced' && e.after?.replacedByMedicineId).map((e) => `${e.at}|${e.after!.replacedByMedicineId}`),
  );

  const changes: (Passport['recentChanges'][number] & { at: number; order: number })[] = [];
  live.forEach((event, order) => {
    const on = dateOf(event.at);
    if (on < since) return;
    // Only 'undone' events lack an `after`, and they were left out above.
    const entry = event.after!;
    const name = entry.productName;
    const push = (kind: Passport['recentChanges'][number]['kind'], text: string) => changes.push({ kind, text, on, at: Date.parse(event.at), order });
    if (event.type !== 'replaced' && replacements.has(`${event.at}|${event.medicineId}`)) return;
    switch (event.type) {
      case 'added':
        if (entry.status === 'taking') push('started', `Started ${name}`);
        break;
      case 'restarted':
        push('started', `Started again: ${name}`);
        break;
      case 'not_started':
        push('not_started', `${name}: prescribed, not started`);
        break;
      case 'changed':
        push('changed', `${name}: ${event.detail}`);
        break;
      case 'replaced': {
        const next = names.get(entry.replacedByMedicineId!);
        push('changed', next ? `${name} replaced by ${next}` : `${name} replaced`);
        break;
      }
      case 'stopped':
        push('stopped', `Stopped ${name}`);
        break;
      default:
        // Confirmations, "not confirmed" and migrations are not changes to what is taken.
        break;
    }
  });
  return changes
    .sort((a, b) => b.at - a.at || b.order - a.order)
    .map(({ kind, text, on }) => ({ kind, text, on }));
}

export function buildPassport(input: PassportInput): Passport {
  const { profile, visit } = input;
  const doctors = new Map(input.prescribers.map((p) => [p.id, p]));
  const visitDoctor = visit ? doctors.get(visit.prescriberId) ?? null : null;

  // The next visit's doctor first, then other doctors by name, then entries with no doctor.
  const group = (m: RoutineMedicine): [number, string] => {
    const doctor = m.prescriberId ? doctors.get(m.prescriberId) : undefined;
    if (!doctor) return [2, ''];
    return [doctor.id === visitDoctor?.id ? 0 : 1, doctor.name];
  };
  const taking = input.routine
    .filter((m) => m.status === 'taking' && !m.legacyReviewPending)
    .sort((a, b) => {
      const [ga, na] = group(a);
      const [gb, nb] = group(b);
      return ga - gb || na.localeCompare(nb) || byName(a, b);
    });

  const unconfirmed = input.routine
    .filter((m) => m.status !== 'stopped' && m.status !== 'not_started' && (m.status === 'uncertain' || m.legacyReviewPending))
    .sort(byName)
    .map((m) => ({ productName: m.productName, reason: m.legacyReviewPending ? UNCONFIRMED_REASONS.legacy : UNCONFIRMED_REASONS.uncertain }));

  const health = [...input.health].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id));
  const allergies = health.filter((h) => h.kind === 'allergy');
  const listed = allergies.filter((h) => !h.noneKnown).map((h) => h.text);

  const documents = new Map(input.documents.map((d) => [d.id, d]));
  const shared = (visit?.sharedDocumentIds ?? []).map((id) => documents.get(id)).filter((d): d is DocumentRecord => d !== undefined);

  const caregiver = profile.caregiverName.trim();
  return {
    profileId: profile.id,
    patientName: profile.name,
    patientAge: profile.birthYear === null ? null : Number(input.today.slice(0, 4)) - profile.birthYear,
    emergencyContact: profile.emergencyContact,
    preparedBy: caregiver ? [caregiver, profile.caregiverRelation.trim()].filter(Boolean).join(', ') : profile.name,
    preparedOn: input.today,
    visit: visit ? { at: visit.at, prescriberName: visitDoctor?.name ?? '', specialty: visitDoctor?.specialty ?? '' } : null,
    currentMedicines: taking.map((m) => ({
      productName: m.productName,
      ingredientsText: ingredientsText(m.ingredients),
      instruction: m.instruction,
      prescriberName: m.prescriberId ? doctors.get(m.prescriberId)?.name ?? null : null,
      source: m.source,
      lastConfirmedOn: m.lastConfirmedAt ? dateOf(m.lastConfirmedAt) : null,
    })),
    unconfirmed,
    allergies: listed.length > 0
      ? { state: 'listed', items: listed }
      : allergies.length > 0 ? { state: 'none_known', items: [] } : { state: 'not_recorded', items: [] },
    conditions: health.filter((h) => h.kind === 'condition').map((h) => h.text),
    procedures: health.filter((h) => h.kind === 'procedure').map((h) => h.text),
    recentChanges: recentChanges(input.events, input.routine, input.today),
    flags: duplicateIngredientGroups(input.routine).map((g) => `${duplicateTitle(g)}. ${DUPLICATE_WORDING}`),
    documents: shared.map((d) => ({ documentId: d.id, title: d.title, kind: d.kind, clinicalDate: d.clinicalDate, sha256: d.sha256, removedAt: null })),
    questions: visit?.questions.map((q) => q.text) ?? [],
  };
}

/**
 * The snapshot to return for "freeze now": the latest one when nothing changed since,
 * otherwise a new one with the next revision number.
 */
export function planSnapshot(
  live: Passport,
  latest: PassportSnapshot | null,
  reason: PassportSnapshot['reason'],
  ctx: { now: string; newId(): ID },
): { snapshot: PassportSnapshot; created: boolean } {
  if (latest && JSON.stringify(latest.passport) === JSON.stringify(live)) return { snapshot: latest, created: false };
  return {
    snapshot: { id: ctx.newId(), profileId: live.profileId, createdAt: ctx.now, reason, passport: structuredClone(live), revision: (latest?.revision ?? 0) + 1 },
    created: true,
  };
}
