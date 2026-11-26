// The v1 → v2 data mapping (docs/specs/00-overview.spec.md, section 9.9). Pure: plain data
// in, plain data out; the time and new ids are passed in. Used by the Dexie upgrade and by
// the backup reader, so both bring v1 data to v2 the same way. Nothing is ever dropped
// silently: every v1 row has a v2 counterpart, except v1 review items, whose effects are
// already in the medicine statuses, and the v1 global Gmail import list, which cannot be
// tied to a profile or an attachment.
import type * as L from '../../../contract/legacy/types';
import type * as T from '../../../contract/types';
import type { SettingRow, StoredShareV2 } from './schema';

/** v1 share row, as the v1 core stored it. */
export interface StoredShareV1 extends L.ShareLink {
  revokeToken: string;
}

export interface V1Tables {
  profiles: L.Profile[];
  prescribers: L.Prescriber[];
  medicines: L.Medicine[];
  events: L.MedicationEvent[];
  documents: L.DocumentRecord[];
  prescriptionLines: L.PrescriptionLine[];
  reviewItems: L.ReviewItem[];
  visits: L.Visit[];
  shares: StoredShareV1[];
  settings: SettingRow[];
}

/** The v2 tables that v1 data maps into. Files are unchanged and not part of this. */
export interface MigratedTables {
  profiles: T.Profile[];
  prescribers: T.Prescriber[];
  documents: T.DocumentRecord[];
  prescriptionLines: T.PrescriptionLine[];
  routine: T.RoutineMedicine[];
  routineEvents: T.RoutineEvent[];
  visits: T.Visit[];
  shares: StoredShareV2[];
  settings: SettingRow[];
}

export interface MigrationContext {
  now: T.ISODateTime;
  newId(): T.ID;
}

/** v1 setting keys that have no v2 meaning. */
export const DROPPED_V1_SETTINGS = ['gmailImportedMessageIds'] as const;

const EVENT_TYPES: Record<L.MedicationEventType, T.RoutineEventType> = {
  added: 'added',
  confirmed: 'confirmed',
  strength_changed: 'changed',
  instruction_changed: 'changed',
  flagged_for_review: 'marked_uncertain',
  marked_stopped: 'stopped',
  replaced: 'replaced',
};

const DOCUMENT_SOURCES: Record<L.DocumentRecord['source'], T.DocumentRecord['source']> = {
  scan: 'camera',
  upload: 'upload',
  email: 'email',
};

const byTime = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

export function migrateProfile(p: L.Profile): T.Profile {
  return { ...p, emergencyContact: null };
}

export function migrateDocument(d: L.DocumentRecord): T.DocumentRecord {
  const email = d.source === 'email';
  return {
    id: d.id,
    profileId: d.profileId,
    kind: d.type,
    title: d.title,
    clinicalDate: d.documentDate,
    dateSource: email ? 'email_received' : 'document',
    addedAt: d.addedAt,
    receivedAt: email ? d.addedAt : null,
    source: DOCUMENT_SOURCES[d.source],
    state: d.state === 'confirmed' ? 'filed' : 'pending_review',
    starred: d.starred,
    prescriberId: d.prescriberId,
    facility: null,
    tags: [],
    testNames: [],
    patientNameRead: null,
    patientMatch: 'not_found',
    mimeType: d.mimeType,
    sha256: d.sha256,
    pageCount: null,
    pagesRead: null,
  };
}

/** Lines keep their stored order within each document; a line confirmed in v1 is verified. */
export function migratePrescriptionLines(lines: L.PrescriptionLine[]): T.PrescriptionLine[] {
  const nextIndex = new Map<T.ID, number>();
  return lines.map((line) => {
    const lineIndex = nextIndex.get(line.documentId) ?? 0;
    nextIndex.set(line.documentId, lineIndex + 1);
    return {
      id: line.id,
      documentId: line.documentId,
      lineIndex,
      productName: line.productName,
      ingredients: line.ingredients,
      form: line.form,
      dosesPerDay: line.dosesPerDay,
      instruction: line.instruction,
      verified: line.fieldState === 'confirmed',
    };
  });
}

/** True when the caregiver, not a rule, confirmed this medicine in v1. */
function confirmedByUser(m: L.Medicine, events: L.MedicationEvent[]): boolean {
  return m.origin === 'manual' || events.some((e) => e.type === 'confirmed' && e.documentId === null);
}

/** True when the caregiver, not a rule, stopped this medicine in v1. */
function stoppedByUser(events: L.MedicationEvent[]): boolean {
  const lastStop = events.filter((e) => e.type === 'marked_stopped' || e.type === 'replaced').sort(byTime).at(-1);
  return lastStop !== undefined && lastStop.type === 'marked_stopped' && lastStop.documentId === null;
}

function lastUserConfirmation(m: L.Medicine, events: L.MedicationEvent[]): T.ISODateTime | null {
  const confirmations = events.filter((e) => e.type === 'confirmed' && e.documentId === null).sort(byTime);
  if (confirmations.length) return confirmations[confirmations.length - 1].at;
  return m.origin === 'manual' ? m.createdAt : null;
}

/** Overview section 9.9, row by row. `events` are this medicine's v1 events. */
export function migrateMedicine(m: L.Medicine, events: L.MedicationEvent[]): T.RoutineMedicine {
  let status: T.RoutineStatus;
  let source: T.RoutineSource;
  let pending: boolean;
  let lastConfirmedAt: T.ISODateTime | null = null;

  switch (m.status) {
    case 'confirmed_current':
      if (confirmedByUser(m, events)) {
        [status, source, pending] = ['taking', 'caregiver_reported', false];
        lastConfirmedAt = lastUserConfirmation(m, events);
      } else {
        // Made current by the v1 prescription rule only: kept, but not shown as current.
        [status, source, pending] = ['uncertain', 'legacy', true];
      }
      break;
    case 'needs_confirmation':
      [status, source, pending] = ['uncertain', 'legacy', true];
      break;
    case 'found_at_home':
      [status, source, pending] = ['uncertain', 'from_pack', true];
      break;
    case 'stopped':
      status = 'stopped';
      source = stoppedByUser(events) ? 'caregiver_reported' : 'legacy';
      pending = false;
      break;
  }

  return {
    id: m.id,
    profileId: m.profileId,
    productName: m.productName,
    ingredients: m.ingredients,
    form: m.form,
    dosesPerDay: m.dosesPerDay,
    instruction: m.instruction,
    status,
    source,
    prescriberId: m.prescriberId,
    sourceDocumentId: m.sourceDocumentId,
    replacedByMedicineId: m.replacedByMedicineId,
    lastConfirmedAt,
    legacyStatus: m.status,
    legacyReviewPending: pending,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** A v1 event keeps its id, time, document and wording; v1 kept no before/after values. */
export function migrateEvent(e: L.MedicationEvent): T.RoutineEvent {
  return {
    id: e.id,
    profileId: e.profileId,
    medicineId: e.medicineId,
    type: EVENT_TYPES[e.type],
    at: e.at,
    documentId: e.documentId,
    proposalId: null,
    before: null,
    after: null,
    undoesEventId: null,
    detail: e.detail,
  };
}

export function migrateVisit(v: L.Visit): T.Visit {
  return {
    ...v,
    questions: v.questions.map((q) => ({ ...q, medicineId: null, documentId: null })),
  };
}

/** v1 links cannot be proven to belong to a profile; they stay revocable from Settings. */
export function migrateShare(s: StoredShareV1): StoredShareV2 {
  return {
    id: s.id,
    profileId: null,
    snapshotId: null,
    url: s.url,
    createdAt: null,
    expiresAt: s.expiresAt,
    revoked: s.revoked,
    revokeToken: s.revokeToken,
  };
}

export function migrateV1(v1: V1Tables, ctx: MigrationContext): MigratedTables {
  const eventsByMedicine = new Map<T.ID, L.MedicationEvent[]>();
  for (const e of v1.events) eventsByMedicine.set(e.medicineId, [...(eventsByMedicine.get(e.medicineId) ?? []), e]);

  const routine = v1.medicines.map((m) => migrateMedicine(m, eventsByMedicine.get(m.id) ?? []));
  const migratedEvents: T.RoutineEvent[] = routine.map((entry) => ({
    id: ctx.newId(),
    profileId: entry.profileId,
    medicineId: entry.id,
    type: 'migrated',
    at: ctx.now,
    documentId: null,
    proposalId: null,
    before: null,
    after: entry,
    undoesEventId: null,
    detail: `Moved to the new medicine list (was: ${entry.legacyStatus})`,
  }));

  const dropped = new Set<string>(DROPPED_V1_SETTINGS);
  return {
    profiles: v1.profiles.map(migrateProfile),
    prescribers: v1.prescribers,
    documents: v1.documents.map(migrateDocument),
    prescriptionLines: migratePrescriptionLines(v1.prescriptionLines),
    routine,
    routineEvents: [...v1.events.map(migrateEvent), ...migratedEvents],
    visits: v1.visits.map(migrateVisit),
    shares: v1.shares.map(migrateShare),
    settings: v1.settings.filter((row) => !dropped.has(row.key)),
  };
}
