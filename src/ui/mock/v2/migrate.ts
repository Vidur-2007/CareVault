// Maps a v1 mock backup into the v2 mock tables, following overview 9.9 in a simple form.
// Only the v1 mock's own backup format can be read here; real v1 backups are the core's.
import type * as L from '../../../contract/legacy/types';
import type * as T from '../../../contract/types';
import type { MockState } from './state';

export interface V1MockData {
  profiles: L.Profile[];
  prescribers: L.Prescriber[];
  medicines: L.Medicine[];
  events: L.MedicationEvent[];
  documents: L.DocumentRecord[];
  prescriptionLines: L.PrescriptionLine[];
  visits: L.Visit[];
  shares: { link: L.ShareLink; key: string; passport: L.Passport }[];
  settings?: { cloudReadingAllowed: boolean };
}

const EVENT: Record<L.MedicationEventType, T.RoutineEventType> = {
  added: 'added', confirmed: 'confirmed', strength_changed: 'changed', instruction_changed: 'changed',
  flagged_for_review: 'marked_uncertain', marked_stopped: 'stopped', replaced: 'replaced',
};

/** A bare v1 passport, wrapped as a v2 one (9.7: sharing.open accepts v1 payloads). */
export function wrapV1Passport(p: L.Passport): T.Passport {
  return {
    profileId: '', patientName: p.patientName, patientAge: p.patientAge, emergencyContact: null,
    preparedBy: p.preparedBy, preparedOn: p.preparedOn,
    visit: p.visitAt ? { at: p.visitAt, prescriberName: p.prescriberName ?? '', specialty: p.prescriberSpecialty ?? '' } : null,
    currentMedicines: p.currentMedicines.map((m) => ({
      productName: m.productName, ingredientsText: '', instruction: m.instruction, prescriberName: m.prescriberName,
      source: 'legacy', lastConfirmedOn: null,
    })),
    unconfirmed: p.changes.filter((c) => c.kind === 'unconfirmed').map((c) => ({ productName: c.text, reason: 'Not confirmed' })),
    allergies: { state: 'not_recorded', items: [] },
    conditions: [], procedures: [], recentChanges: [], flags: p.flags,
    documents: p.documents.map((d, i) => ({
      documentId: `v1-${i}`, title: d.title, kind: 'other', clinicalDate: d.documentDate, sha256: '', removedAt: null,
    })),
    questions: p.questions,
  };
}

function medicine(m: L.Medicine, events: L.MedicationEvent[]): T.RoutineMedicine {
  const userConfirmed = events.some((e) => e.medicineId === m.id && e.type === 'confirmed' && e.documentId === null);
  const lastStop = events.filter((e) => e.medicineId === m.id && (e.type === 'marked_stopped' || e.type === 'replaced')).at(-1);
  let status: T.RoutineStatus;
  let source: T.RoutineSource;
  let pending = false;
  if (m.status === 'confirmed_current' && (userConfirmed || m.origin === 'manual')) {
    status = 'taking'; source = 'caregiver_reported';
  } else if (m.status === 'confirmed_current' || m.status === 'needs_confirmation') {
    status = 'uncertain'; source = m.origin === 'home_scan' ? 'from_pack' : 'legacy'; pending = true;
  } else if (m.status === 'found_at_home') {
    status = 'uncertain'; source = 'from_pack'; pending = true;
  } else {
    status = 'stopped'; source = lastStop?.type === 'replaced' || m.replacedByMedicineId ? 'legacy' : 'caregiver_reported';
  }
  return {
    id: m.id, profileId: m.profileId, productName: m.productName, ingredients: m.ingredients, form: m.form,
    dosesPerDay: m.dosesPerDay, instruction: m.instruction, status, source, prescriberId: m.prescriberId,
    sourceDocumentId: m.sourceDocumentId, replacedByMedicineId: m.replacedByMedicineId,
    lastConfirmedAt: status === 'taking' ? m.updatedAt : null, legacyStatus: m.status, legacyReviewPending: pending,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
  };
}

/** Fills `state` (already emptied) from v1 mock data. */
export function migrateV1(state: MockState, data: V1MockData, now: string, newId: () => string): void {
  state.profiles = data.profiles.map((p) => ({ ...p, emergencyContact: null }));
  state.prescribers = data.prescribers.map((p) => ({ ...p }));
  state.routine = data.medicines.map((m) => medicine(m, data.events));
  state.events = [
    ...data.events.map((e): T.RoutineEvent => ({
      id: e.id, profileId: e.profileId, medicineId: e.medicineId, type: EVENT[e.type], at: e.at, documentId: e.documentId,
      proposalId: null, before: null, after: null, undoesEventId: null, detail: e.detail,
    })),
    ...state.routine.map((m): T.RoutineEvent => ({
      id: newId(), profileId: m.profileId, medicineId: m.id, type: 'migrated', at: now, documentId: null, proposalId: null,
      before: null, after: structuredClone(m), undoesEventId: null, detail: `Brought over from the earlier version (${m.legacyStatus})`,
    })),
  ];
  state.documents = data.documents.map((d): T.DocumentRecord => ({
    id: d.id, profileId: d.profileId, kind: d.type, title: d.title, clinicalDate: d.documentDate || null,
    dateSource: d.documentDate ? (d.source === 'email' ? 'email_received' : 'document') : 'unknown',
    addedAt: d.addedAt, receivedAt: null, source: d.source === 'scan' ? 'camera' : d.source,
    state: d.state === 'confirmed' ? 'filed' : 'pending_review', starred: d.starred, prescriberId: d.prescriberId,
    facility: null, tags: [], testNames: [], patientNameRead: null, patientMatch: 'not_found', mimeType: d.mimeType,
    sha256: d.sha256, pageCount: null, pagesRead: null,
  }));
  const index = new Map<string, number>();
  state.lines = data.prescriptionLines.map((l): T.PrescriptionLine => {
    const i = index.get(l.documentId) ?? 0;
    index.set(l.documentId, i + 1);
    return {
      id: l.id, documentId: l.documentId, lineIndex: i, productName: l.productName, ingredients: l.ingredients, form: l.form,
      dosesPerDay: l.dosesPerDay, instruction: l.instruction, verified: l.fieldState === 'confirmed',
    };
  });
  state.visits = data.visits.map((v) => ({
    ...v, questions: v.questions.map((q) => ({ ...q, medicineId: null, documentId: null })),
  }));
  state.shares = data.shares.map((s) => ({
    key: s.key, legacyPassport: wrapV1Passport(s.passport),
    link: { id: s.link.id, profileId: null, snapshotId: null, url: s.link.url, createdAt: null, expiresAt: s.link.expiresAt, revoked: s.link.revoked },
  }));
  state.settings = { cloudReadingAllowed: data.settings?.cloudReadingAllowed ?? false };
  for (const p of state.profiles) state.revisions.set(p.id, 1);
}
