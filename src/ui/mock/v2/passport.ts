// Passport and attention rules for the v2 mock (overview 9.5, 9.6).
import * as T from '../../../contract/types';
import type { MockCtx } from './state';
import { DUPLICATE_WORDING, evidenceOf, ingredientTotals, nextVisit } from './routine';
import { addDays } from './text';

export function getProfile(ctx: MockCtx, id: T.ID): T.Profile {
  const p = ctx.state.profiles.find((x) => x.id === id);
  if (!p) throw new T.ServiceError('not_found', 'This profile is not on this device.');
  return p;
}

const RECENT_KIND: Partial<Record<T.RoutineEventType, T.Passport['recentChanges'][number]['kind']>> = {
  added: 'started', restarted: 'started', changed: 'changed', stopped: 'stopped', not_started: 'not_started',
};

function recentText(e: T.RoutineEvent, kind: T.Passport['recentChanges'][number]['kind']): string {
  const name = (e.after ?? e.before)?.productName ?? 'A medicine';
  switch (kind) {
    case 'started': return `Started ${name}`;
    case 'stopped': return `Stopped ${name}`;
    case 'not_started': return `${name} prescribed, not started`;
    default: return e.before === null ? `${name} (${e.detail})` : `${name}: ${e.detail}`;
  }
}

function duplicateFlags(ctx: MockCtx, profileId: T.ID): string[] {
  return ingredientTotals(ctx, profileId).map((t) => {
    const names = t.parts.map((p) => p.productName);
    const list = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return `${list} (${t.ingredient}). ${DUPLICATE_WORDING}`;
  });
}

/** passport.live: computed now, never stored. */
export function livePassport(ctx: MockCtx, profileId: T.ID): T.Passport {
  const { state } = ctx;
  const profile = getProfile(ctx, profileId);
  const today = ctx.today(profileId);
  const visit = nextVisit(ctx, profileId);
  const prescriber = (id: T.ID | null) => state.prescribers.find((p) => p.id === id) ?? null;
  const mine = state.routine.filter((m) => m.profileId === profileId);
  const health = state.health.filter((h) => h.profileId === profileId);
  const allergies = health.filter((h) => h.kind === 'allergy');

  // The visit's prescriber first, then other prescribers by name, then no prescriber; by product name within.
  const group = (m: T.RoutineMedicine) => {
    if (visit && m.prescriberId === visit.prescriberId) return '0';
    const p = prescriber(m.prescriberId);
    return p ? `1 ${p.name.toLowerCase()}` : '2';
  };
  const current = mine
    .filter((m) => m.status === 'taking')
    .sort((a, b) => group(a).localeCompare(group(b)) || a.productName.localeCompare(b.productName));

  const unconfirmed = mine
    .filter((m) => m.status !== 'stopped' && (m.status === 'uncertain' || m.legacyReviewPending))
    .sort((a, b) => a.productName.localeCompare(b.productName))
    .map((m) => ({
      productName: m.productName,
      reason: m.legacyReviewPending ? 'From the earlier version of CareVault; not reviewed yet' : 'Current use not confirmed',
    }));

  const since = addDays(today, -90);
  const recentChanges = state.events
    .filter((e) => e.profileId === profileId && e.at.slice(0, 10) >= since && RECENT_KIND[e.type])
    .filter((e) => !state.events.some((u) => u.undoesEventId === e.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => {
      const kind = RECENT_KIND[e.type]!;
      return { kind, text: recentText(e, kind), on: e.at.slice(0, 10) };
    });

  const visitPrescriber = visit ? prescriber(visit.prescriberId) : null;
  return {
    profileId,
    patientName: profile.name,
    patientAge: profile.birthYear === null ? null : Number(today.slice(0, 4)) - profile.birthYear,
    emergencyContact: profile.emergencyContact,
    preparedBy: profile.caregiverName
      ? [profile.caregiverName, profile.caregiverRelation].filter(Boolean).join(', ')
      : profile.name,
    preparedOn: today,
    visit: visit ? { at: visit.at, prescriberName: visitPrescriber?.name ?? '', specialty: visitPrescriber?.specialty ?? '' } : null,
    currentMedicines: current.map((m) => ({
      productName: m.productName,
      ingredientsText: m.ingredients.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + '),
      instruction: m.instruction,
      prescriberName: prescriber(m.prescriberId)?.name ?? null,
      source: m.source,
      lastConfirmedOn: m.lastConfirmedAt?.slice(0, 10) ?? null,
    })),
    unconfirmed,
    allergies: allergies.some((a) => a.noneKnown)
      ? { state: 'none_known', items: [] }
      : allergies.length ? { state: 'listed', items: allergies.map((a) => a.text) } : { state: 'not_recorded', items: [] },
    conditions: health.filter((h) => h.kind === 'condition').map((h) => h.text),
    procedures: health.filter((h) => h.kind === 'procedure').map((h) => h.text),
    recentChanges,
    flags: duplicateFlags(ctx, profileId),
    documents: (visit?.sharedDocumentIds ?? [])
      .map((id) => state.documents.find((d) => d.id === id))
      .filter((d): d is T.DocumentRecord => d !== undefined)
      .map((d) => ({ documentId: d.id, title: d.title, kind: d.kind, clinicalDate: d.clinicalDate, sha256: d.sha256, removedAt: null })),
    questions: visit?.questions.map((q) => q.text) ?? [],
  };
}

/** attention.list: ids are stable for the same underlying condition. */
export function attentionItems(ctx: MockCtx, profileId: T.ID): T.AttentionItem[] {
  const { state } = ctx;
  const items: T.AttentionItem[] = [];
  const docs = state.documents.filter((d) => d.profileId === profileId);

  for (const d of docs) {
    const flagged = evidenceOf(ctx, d.id).filter((e) => e.status === 'needs_verification');
    if (!flagged.length) continue;
    items.push({
      id: `unverified:${d.id}`, kind: 'unverified_fields',
      title: flagged.length === 1 ? `Check one value in ${d.title}` : `Check ${flagged.length} values in ${d.title}`,
      body: 'Some values could not be read clearly. Nothing reaches the routine until they are checked.',
      documentId: d.id, medicineIds: [],
    });
  }
  for (const d of docs) {
    if (d.source !== 'email' || d.patientMatch !== 'mismatch' || d.state !== 'pending_review') continue;
    items.push({
      id: `unassigned:${d.id}`, kind: 'unassigned_import',
      title: `${d.title} may be for someone else`,
      body: `The name on it is "${d.patientNameRead ?? ''}". Choose whose record it is, or remove it.`,
      documentId: d.id, medicineIds: [],
    });
  }
  for (const t of ingredientTotals(ctx, profileId)) {
    items.push({
      id: `duplicate:${profileId}:${t.ingredient}`, kind: 'possible_duplicate_ingredient',
      title: `${t.parts.map((p) => p.productName).join(' and ')} may contain the same ingredient`,
      body: DUPLICATE_WORDING, documentId: null, medicineIds: t.parts.map((p) => p.medicineId),
    });
  }
  const legacy = state.routine.filter((m) => m.profileId === profileId && m.legacyReviewPending && m.status !== 'stopped');
  if (legacy.length) {
    items.push({
      id: `legacy:${profileId}`, kind: 'legacy_routine_review',
      title: legacy.length === 1 ? 'One medicine from the earlier version needs a look' : `${legacy.length} medicines from the earlier version need a look`,
      body: 'Say which of them are still taken. Until then they are listed as unconfirmed.',
      documentId: null, medicineIds: legacy.map((m) => m.id),
    });
  }
  return items;
}
