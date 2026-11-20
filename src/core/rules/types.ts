// Shared shapes for the rules engine. Rules are pure: plain data in, plain data out.
// They never read a clock, a random source, the database or the network.
import type {
  DocumentRecord,
  ID,
  ISODate,
  ISODateTime,
  Medicine,
  MedicationEvent,
  PrescriptionLine,
  Prescriber,
  Profile,
  ReviewItem,
  Visit,
} from '../../contract/legacy/types';

/** Everything the rules need to know about one profile. */
export interface RulesState {
  profile: Profile;
  prescribers: Prescriber[];
  medicines: Medicine[];
  events: MedicationEvent[];
  documents: DocumentRecord[];
  prescriptionLines: PrescriptionLine[];
  reviewItems: ReviewItem[];
  visits: Visit[];
}

export type IdKind = 'medicine' | 'event' | 'reviewItem' | 'question' | 'line';

/**
 * The outside world, handed in. `newId` receives the kind of row and a seed that
 * describes what the id is for, so a test can return fixed ids; the app ignores both
 * and returns a random id.
 */
export interface RuleContext {
  now: ISODateTime;
  today: ISODate;
  newId(kind: IdKind, seed: string): ID;
}

/** Rows to store. Every list holds complete rows; a row with a known id replaces it. */
export interface WritePlan {
  medicines: Medicine[];
  events: MedicationEvent[];
  reviewItems: ReviewItem[];
  prescriptionLines: PrescriptionLine[];
  documents: DocumentRecord[];
  visits: Visit[];
  deletedDocumentIds: ID[];
  /** Open questions that no longer apply to anything and are removed, not answered. */
  deletedReviewItemIds: ID[];
}

export function emptyPlan(): WritePlan {
  return {
    medicines: [],
    events: [],
    reviewItems: [],
    prescriptionLines: [],
    documents: [],
    visits: [],
    deletedDocumentIds: [],
    deletedReviewItemIds: [],
  };
}

export function isEmptyPlan(plan: WritePlan): boolean {
  return Object.values(plan).every((rows) => rows.length === 0);
}

function upsert<T extends { id: ID }>(rows: readonly T[], changes: readonly T[]): T[] {
  if (changes.length === 0) return [...rows];
  const changed = new Map(changes.map((row) => [row.id, row]));
  const kept = rows.map((row) => {
    const replacement = changed.get(row.id);
    if (replacement) changed.delete(row.id);
    return replacement ?? row;
  });
  return [...kept, ...changed.values()];
}

/** Plans in the order they happen. Later plans win where both touch the same row. */
export function mergePlans(...plans: WritePlan[]): WritePlan {
  const merged = emptyPlan();
  for (const plan of plans) {
    merged.medicines = upsert(merged.medicines, plan.medicines);
    merged.events = upsert(merged.events, plan.events);
    merged.prescriptionLines = upsert(merged.prescriptionLines, plan.prescriptionLines);
    merged.visits = upsert(merged.visits, plan.visits);

    // A row written after it was deleted exists again; a row deleted after it was
    // written is gone.
    const rewrittenItems = new Set(plan.reviewItems.map((r) => r.id));
    const deletedItems = new Set(plan.deletedReviewItemIds);
    merged.reviewItems = upsert(merged.reviewItems, plan.reviewItems).filter((r) => !deletedItems.has(r.id));
    merged.deletedReviewItemIds = [
      ...new Set([...merged.deletedReviewItemIds.filter((id) => !rewrittenItems.has(id)), ...deletedItems]),
    ];

    const rewrittenDocs = new Set(plan.documents.map((d) => d.id));
    const deletedDocs = new Set(plan.deletedDocumentIds);
    merged.documents = upsert(merged.documents, plan.documents).filter((d) => !deletedDocs.has(d.id));
    merged.deletedDocumentIds = [
      ...new Set([...merged.deletedDocumentIds.filter((id) => !rewrittenDocs.has(id)), ...deletedDocs]),
    ];
  }
  return merged;
}

/** The state as it will be once the plan is stored. */
export function applyPlan(state: RulesState, plan: WritePlan): RulesState {
  const gone = new Set(plan.deletedDocumentIds);
  const goneItems = new Set(plan.deletedReviewItemIds);
  return {
    profile: state.profile,
    prescribers: state.prescribers,
    medicines: upsert(state.medicines, plan.medicines),
    events: upsert(state.events, plan.events),
    reviewItems: upsert(state.reviewItems, plan.reviewItems).filter((r) => !goneItems.has(r.id)),
    documents: upsert(state.documents, plan.documents).filter((d) => !gone.has(d.id)),
    prescriptionLines: upsert(state.prescriptionLines, plan.prescriptionLines).filter(
      (l) => !gone.has(l.documentId),
    ),
    visits: upsert(state.visits, plan.visits).map((visit) =>
      visit.sharedDocumentIds.some((id) => gone.has(id))
        ? { ...visit, sharedDocumentIds: visit.sharedDocumentIds.filter((id) => !gone.has(id)) }
        : visit,
    ),
  };
}
