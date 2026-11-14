// Which review items should exist, and what answering one changes.
//
// CareVault never decides for the caregiver. These rules only open questions and carry
// out the answer that was given.
import {
  ServiceError,
  type DocumentRecord,
  type DocumentType,
  type ID,
  type Medicine,
  type ReviewItem,
  type ReviewResolution,
} from '../../contract/types';
import { buildDiff } from './prescriptions';
import { isActive, makeEvent } from './status';
import { countWord, dayAndMonth, joinNames, pronounsFor, weekday } from './text';
import { duplicateGroups } from './totals';
import {
  applyPlan,
  emptyPlan,
  mergePlans,
  type RuleContext,
  type RulesState,
  type WritePlan,
} from './types';
import { nextVisit, planAddQuestion } from './visits';

const setKey = (ids: readonly ID[]) => [...ids].sort().join('|');

interface DuplicateSet {
  /** Every ingredient this exact set of medicines shares. */
  ingredients: string[];
  medicines: Medicine[];
}

/** Duplicate groups merged by set of medicines, so one set gets one question. */
function duplicateSets(state: RulesState): DuplicateSet[] {
  const sets = new Map<string, DuplicateSet>();
  for (const group of duplicateGroups(state.medicines)) {
    const key = setKey(group.medicines.map((m) => m.id));
    const existing = sets.get(key);
    if (existing) existing.ingredients.push(group.ingredient);
    else sets.set(key, { ingredients: [group.ingredient], medicines: group.medicines });
  }
  return [...sets.values()];
}

const DOCUMENT_WORDS: Record<DocumentType, string> = {
  prescription: 'a prescription',
  lab_report: 'a lab report',
  test: 'a test report',
  discharge_summary: 'a discharge summary',
  other: 'a medical document',
};

function duplicateItem(state: RulesState, set: DuplicateSet, ctx: RuleContext): ReviewItem {
  const names = set.medicines.map((m) => m.productName);
  const atHome = set.medicines.every((m) => m.origin === 'home_scan') ? ' at home' : '';
  const singleIngredient = set.medicines.every((m) => m.ingredients.length === 1);
  const what = singleIngredient
    ? 'are different brands of the same ingredient'
    : `all contain ${joinNames(set.ingredients)}`;
  return {
    id: ctx.newId('reviewItem', `possible_duplicate:${set.ingredients.join('+')}`),
    profileId: state.profile.id,
    kind: 'possible_duplicate',
    title: `${countWord(names.length)} products${atHome} contain ${joinNames(set.ingredients)}`,
    body: `${joinNames(names)} ${what}. Please check with a pharmacist before ${names.length === 2 ? 'both' : 'they'} are used on the same day.`,
    medicineIds: set.medicines.map((m) => m.id),
    documentId: null,
    createdAt: ctx.now,
    resolvedAt: null,
    resolution: null,
  };
}

function newDocumentItem(state: RulesState, doc: DocumentRecord, ctx: RuleContext): ReviewItem {
  const pronouns = pronounsFor(state.profile.relation);
  const fileWord = doc.mimeType === 'application/pdf' ? 'A PDF' : 'A file';
  return {
    id: ctx.newId('reviewItem', `new_document:${doc.id}`),
    profileId: state.profile.id,
    kind: 'new_document',
    title: `Add this ${doc.title} to ${pronouns.possessive} records?`,
    body: `${fileWord} arrived in the connected inbox on ${weekday(doc.addedAt)}, ${dayAndMonth(doc.addedAt)}. It looks like ${DOCUMENT_WORDS[doc.type]} for ${state.profile.name}. Nothing is saved until you confirm.`,
    medicineIds: [],
    documentId: doc.id,
    // The question is about the arrival of the document, so it carries that time.
    createdAt: doc.addedAt,
    resolvedAt: null,
    resolution: null,
  };
}

function confirmItem(state: RulesState, medicine: Medicine, ctx: RuleContext): ReviewItem {
  const pronouns = pronounsFor(state.profile.relation);
  return {
    id: ctx.newId('reviewItem', `confirm_medicine:${medicine.id}`),
    profileId: state.profile.id,
    kind: 'confirm_medicine',
    title: `${pronouns.be === 'is' ? 'Is' : 'Are'} ${pronouns.subject} still taking ${medicine.productName}?`,
    body: 'It was marked as needing confirmation. Please confirm what is being taken.',
    medicineIds: [medicine.id],
    documentId: null,
    createdAt: ctx.now,
    resolvedAt: null,
    resolution: null,
  };
}

/**
 * Review items that should exist and do not yet. Calling it again on the state that
 * includes its own result returns nothing: it never duplicates an open item.
 *
 * - `possible_duplicate`: one per set of active medicines that share an ingredient,
 *   unless that set already has an open item or the caregiver has already answered it
 *   with "ask the doctor" or dismissed it.
 * - `new_document`: one per unconfirmed document that arrived by email.
 * - `confirm_medicine`: one per medicine waiting for confirmation that has no question
 *   open or parked for the doctor. (Prescription comparison opens its own, with detail.)
 */
export function expectedReviewItems(state: RulesState, ctx: RuleContext): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const set of duplicateSets(state)) {
    const key = setKey(set.medicines.map((m) => m.id));
    const covered = state.reviewItems.some(
      (item) =>
        item.kind === 'possible_duplicate' &&
        setKey(item.medicineIds) === key &&
        (item.resolvedAt === null || item.resolution === 'ask_doctor' || item.resolution === 'dismissed'),
    );
    if (!covered) items.push(duplicateItem(state, set, ctx));
  }

  for (const doc of state.documents) {
    if (doc.source !== 'email' || doc.state !== 'pending_confirmation') continue;
    const covered = state.reviewItems.some((item) => item.kind === 'new_document' && item.documentId === doc.id);
    if (!covered) items.push(newDocumentItem(state, doc, ctx));
  }

  for (const medicine of state.medicines) {
    if (medicine.status !== 'needs_confirmation') continue;
    const covered = state.reviewItems.some(
      (item) =>
        item.kind === 'confirm_medicine' &&
        item.medicineIds.includes(medicine.id) &&
        (item.resolvedAt === null ||
          // Parked for the doctor, and nothing has happened to the medicine since.
          (item.resolution === 'ask_doctor' && Date.parse(item.resolvedAt) >= Date.parse(medicine.updatedAt))),
    );
    if (!covered) items.push(confirmItem(state, medicine, ctx));
  }

  return items;
}

/**
 * Open items that no longer apply.
 *
 * - A duplicate question whose set of medicines is no longer a duplicate is removed.
 * - A document question whose document was confirmed is closed as `added`; one whose
 *   document is gone is removed.
 * - A confirm question whose medicines are no longer waiting is closed with the answer
 *   their status now shows.
 */
function planStaleItems(state: RulesState, ctx: RuleContext): WritePlan {
  const plan = emptyPlan();
  const liveSets = new Set(duplicateSets(state).map((set) => setKey(set.medicines.map((m) => m.id))));
  const close = (item: ReviewItem, resolution: ReviewResolution) =>
    plan.reviewItems.push({ ...item, resolvedAt: ctx.now, resolution });

  for (const item of state.reviewItems) {
    if (item.resolvedAt !== null) continue;

    if (item.kind === 'possible_duplicate') {
      if (!liveSets.has(setKey(item.medicineIds))) plan.deletedReviewItemIds.push(item.id);
    } else if (item.kind === 'new_document') {
      const doc = state.documents.find((d) => d.id === item.documentId);
      if (!doc) plan.deletedReviewItemIds.push(item.id);
      else if (doc.state === 'confirmed') close(item, 'added');
    } else if (item.kind === 'confirm_medicine') {
      const medicines = item.medicineIds
        .map((id) => state.medicines.find((m) => m.id === id))
        .filter((m): m is Medicine => m !== undefined);
      if (medicines.some((m) => m.status === 'needs_confirmation')) continue;
      if (medicines.length === 0) plan.deletedReviewItemIds.push(item.id);
      else if (medicines.every((m) => m.status === 'stopped')) close(item, 'stopped');
      else if (medicines.every((m) => m.status === 'confirmed_current')) close(item, 'still_taking');
      else close(item, 'dismissed');
    }
  }
  return plan;
}

/** Brings the review inbox in line with the state: closes stale items, opens missing ones. */
export function planReviewRefresh(state: RulesState, ctx: RuleContext): WritePlan {
  const stale = planStaleItems(state, ctx);
  const opened = emptyPlan();
  opened.reviewItems.push(...expectedReviewItems(applyPlan(state, stale), ctx));
  return mergePlans(stale, opened);
}

/** A plan followed by the inbox refresh it makes necessary. */
export function withReviewRefresh(state: RulesState, plan: WritePlan, ctx: RuleContext): WritePlan {
  return mergePlans(plan, planReviewRefresh(applyPlan(state, plan), ctx));
}

/** 'Rosuvastatin 10 mg' -> 'Rosuvastatin'. A name with no unit ('Dolo 650') is kept. */
export function withoutStrength(productName: string): string {
  return productName.replace(/\s+\d+(\.\d+)?\s*(mcg|mg|g|ml|iu)\b.*$/i, '').trim() || productName;
}

/** The question that "ask the doctor" puts on the next visit for this item. */
export function questionFor(state: RulesState, item: ReviewItem): string {
  const pronouns = pronounsFor(state.profile.relation);
  const medicines = item.medicineIds
    .map((id) => state.medicines.find((m) => m.id === id))
    .filter((m): m is Medicine => m !== undefined);
  const names = medicines.map((m) => m.productName);

  if (item.kind === 'possible_duplicate' && medicines.length >= 2) {
    const shared = duplicateGroups(medicines.map((m) => (isActive(m) ? m : { ...m, status: 'found_at_home' })))
      .filter((g) => g.medicines.length === medicines.length)
      .map((g) => g.ingredient);
    const why = shared.length > 0 ? ` ${names.length === 2 ? 'Both' : 'They all'} contain ${joinNames(shared)}.` : '';
    return `Can ${pronouns.subject} use ${joinNames(names)} on the same day?${why}`;
  }

  if (item.kind === 'confirm_medicine' && medicines.length > 0) {
    const name = joinNames(names.map(withoutStrength));
    const doc = state.documents.find((d) => d.id === item.documentId);
    const diff = doc?.prescriberId ? buildDiff(state, doc.prescriberId, doc.id) : null;
    const added = (diff?.rows ?? [])
      .filter((row) => row.kind === 'added' && row.latest)
      .map((row) => withoutStrength(row.latest!.productName));
    if (added.length > 0) {
      const both = added.length === 1 && medicines.length === 1 ? 'both' : 'all of them';
      return `${added.length === 1 ? 'Does' : 'Do'} ${joinNames(added)} replace ${name}, or should ${pronouns.subject} take ${both}?`;
    }
    return `Should ${pronouns.subject} still take ${name}? It is not on the latest prescription.`;
  }

  return `Please check: ${item.title}`;
}

/** True when a question on the visit already names every one of these products. */
function alreadyAsked(questions: readonly { text: string }[], productNames: readonly string[]): boolean {
  if (productNames.length === 0) return false;
  const firstWords = productNames.map((name) => name.trim().split(/\s+/)[0].toLowerCase());
  return questions.some((q) => {
    const text = q.text.toLowerCase();
    return firstWords.every((word) => text.includes(word));
  });
}

/**
 * What the caregiver's answer to a review item changes.
 *
 * - `still_taking`: its medicines become `confirmed_current`.
 * - `stopped`: its medicines become `stopped`.
 * - `ask_doctor`: nothing about the medicines changes; a question goes on the next visit.
 * - `only_one`: every medicine in the item except `keepMedicineId` becomes `stopped`.
 * - `added`: its document is confirmed.
 * - `dismissed`: for an unconfirmed document, the document is removed ("not his").
 *
 * An item that is already resolved gives an empty plan.
 */
export function planReviewResolution(
  state: RulesState,
  item: ReviewItem,
  resolution: ReviewResolution,
  opts: { keepMedicineId?: ID } | undefined,
  ctx: RuleContext,
): WritePlan {
  const plan = emptyPlan();
  if (item.resolvedAt !== null) return plan;

  const medicines = item.medicineIds
    .map((id) => state.medicines.find((m) => m.id === id))
    .filter((m): m is Medicine => m !== undefined);

  switch (resolution) {
    case 'still_taking':
      for (const medicine of medicines) {
        plan.medicines.push({ ...medicine, status: 'confirmed_current', fieldState: 'confirmed', updatedAt: ctx.now });
        plan.events.push(makeEvent(medicine, 'confirmed', 'Confirmed by the caregiver', null, ctx));
      }
      break;

    case 'stopped':
      for (const medicine of medicines) {
        plan.medicines.push({ ...medicine, status: 'stopped', updatedAt: ctx.now });
        plan.events.push(makeEvent(medicine, 'marked_stopped', 'Marked as stopped by the caregiver', null, ctx));
      }
      break;

    case 'ask_doctor': {
      const visit = nextVisit(state, ctx.today);
      if (visit && !alreadyAsked(visit.questions, medicines.map((m) => m.productName))) {
        plan.visits.push(...planAddQuestion(visit, questionFor(state, item), 'review', ctx).visits);
      }
      break;
    }

    case 'only_one': {
      const keep = opts?.keepMedicineId;
      if (!keep || !medicines.some((m) => m.id === keep)) {
        // Without a valid choice every product would be stopped. Refuse instead.
        throw new ServiceError('unknown', 'Please choose which product is taken.');
      }
      for (const medicine of medicines) {
        if (medicine.id === keep || medicine.status === 'stopped') continue;
        plan.medicines.push({ ...medicine, status: 'stopped', updatedAt: ctx.now });
        plan.events.push(
          makeEvent(medicine, 'marked_stopped', 'Marked as stopped: only one of these products is taken', null, ctx),
        );
      }
      break;
    }

    case 'added': {
      const doc = state.documents.find((d) => d.id === item.documentId);
      if (doc && doc.state !== 'confirmed') plan.documents.push({ ...doc, state: 'confirmed' });
      break;
    }

    case 'dismissed': {
      const doc = state.documents.find((d) => d.id === item.documentId);
      if (item.kind === 'new_document' && doc?.state === 'pending_confirmation') {
        plan.deletedDocumentIds.push(doc.id);
      }
      break;
    }
  }

  plan.reviewItems.push({ ...item, resolvedAt: ctx.now, resolution });
  return plan;
}
