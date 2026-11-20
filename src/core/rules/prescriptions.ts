// Applying a prescription: store its lines, compare it with the previous prescription
// from the same prescriber, and work out what that means for the medicine list.
import {
  ServiceError,
  type DocumentRecord,
  type ID,
  type Ingredient,
  type Medicine,
  type PrescriptionDiff,
  type PrescriptionLine,
  type ReviewItem,
} from '../../contract/legacy/types';
import { describeChange, diffPrescriptions, linesIdentical, strengthDiffers } from './diff';
import { normalizeIngredients, sameMedicine } from './normalize';
import { makeEvent, type LineFields } from './status';
import { dayAndMonth, joinNames, mediumDate, pronounsFor } from './text';
import { applyPlan, emptyPlan, type RuleContext, type RulesState, type WritePlan } from './types';

export function linesOf(state: RulesState, documentId: ID): PrescriptionLine[] {
  return state.prescriptionLines.filter((line) => line.documentId === documentId);
}

/** Prescriptions from one prescriber that have stored lines, oldest first. */
export function prescriptionsFrom(state: RulesState, prescriberId: ID): DocumentRecord[] {
  return state.documents
    .filter((d) => d.type === 'prescription' && d.prescriberId === prescriberId)
    .filter((d) => state.prescriptionLines.some((line) => line.documentId === d.id))
    .sort(
      (a, b) =>
        a.documentDate.localeCompare(b.documentDate) ||
        Date.parse(a.addedAt) - Date.parse(b.addedAt) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * The comparison for one prescription (the prescriber's latest unless `documentId` is
 * given) against the one before it. Null when the prescriber has no stored prescription.
 */
export function buildDiff(state: RulesState, prescriberId: ID, documentId?: ID): PrescriptionDiff | null {
  const docs = prescriptionsFrom(state, prescriberId);
  const index = documentId === undefined ? docs.length - 1 : docs.findIndex((d) => d.id === documentId);
  if (index < 0) return null;
  const latest = docs[index];
  const previous = index > 0 ? docs[index - 1] : null;

  const drafts = diffPrescriptions(
    previous ? linesOf(state, previous.id) : null,
    linesOf(state, latest.id),
    pronounsFor(state.profile.relation),
  );

  const rows = drafts.map((draft) => {
    let reviewItemId: ID | null = null;
    if (draft.kind === 'review' && draft.previous) {
      const missing = draft.previous.ingredients;
      const items = state.reviewItems.filter(
        (item) =>
          item.kind === 'confirm_medicine' &&
          item.documentId === latest.id &&
          item.medicineIds.some((id) => {
            const medicine = state.medicines.find((m) => m.id === id);
            return medicine !== undefined && sameMedicine(medicine.ingredients, missing);
          }),
      );
      reviewItemId = (items.find((item) => item.resolvedAt === null) ?? items[0])?.id ?? null;
    }
    return { ...draft, reviewItemId };
  });

  return {
    prescriberId,
    previousDocumentId: previous?.id ?? null,
    latestDocumentId: latest.id,
    rows,
  };
}

export type LineInput = LineFields & { id?: ID };

/**
 * What to store when the caregiver saves the confirmed lines of a prescription.
 *
 * - A line new for this prescriber adds a medicine as `confirmed_current`.
 * - The same ingredients with a different strength, number per day, form or instruction
 *   replace the old medicine: the old one is `stopped` and points at the new one.
 * - An identical line changes nothing.
 * - A medicine that was on the previous prescription and is missing from this one becomes
 *   `needs_confirmation` with a question for the caregiver. It is never stopped here.
 * - Medicines from other prescribers are never touched.
 *
 * Applying a document that already has stored lines returns an empty plan. A prescription
 * dated before one already stored for the prescriber only stores its lines: the current
 * medicine list follows the newest prescription.
 */
export function planPrescriptionApply(
  state: RulesState,
  prescriberId: ID,
  documentId: ID,
  lines: readonly LineInput[],
  ctx: RuleContext,
): WritePlan {
  const doc = state.documents.find((d) => d.id === documentId);
  if (!doc) throw new ServiceError('not_found', 'This document is not in the records.');
  const prescriber = state.prescribers.find((p) => p.id === prescriberId);
  if (!prescriber) throw new ServiceError('not_found', 'This prescriber is not in the records.');

  const plan = emptyPlan();
  if (linesOf(state, documentId).length > 0) return plan;

  const newLines: PrescriptionLine[] = lines.map((line, index) => ({
    id: line.id ?? ctx.newId('line', `${documentId}:${index}`),
    documentId,
    productName: line.productName.trim(),
    ingredients: normalizeIngredients(line.ingredients),
    form: line.form,
    dosesPerDay: line.dosesPerDay,
    instruction: line.instruction.trim(),
    fieldState: 'confirmed',
  }));
  plan.prescriptionLines.push(...newLines);
  if (doc.type !== 'prescription' || doc.prescriberId !== prescriberId) {
    plan.documents.push({ ...doc, type: 'prescription', prescriberId });
  }

  const withLines = applyPlan(state, plan);
  const docs = prescriptionsFrom(withLines, prescriberId);
  const index = docs.findIndex((d) => d.id === documentId);
  if (index !== docs.length - 1) return plan;
  const previousDoc = index > 0 ? docs[index - 1] : null;

  const pronouns = pronounsFor(state.profile.relation);
  const rows = diffPrescriptions(previousDoc ? linesOf(withLines, previousDoc.id) : null, newLines, pronouns);
  const who = prescriber.name;
  const when = mediumDate(doc.documentDate);

  // Medicines as they change while the rows are worked through.
  const medicines = new Map(state.medicines.map((m) => [m.id, m]));
  const claimed = new Set<ID>();
  const changedMedicines = new Map<ID, Medicine>();
  const changedItems = new Map<ID, ReviewItem>();

  /** This prescriber's medicine with the same ingredients that is not stopped, newest first. */
  const current = (ingredients: readonly Ingredient[]): Medicine | undefined =>
    [...medicines.values()]
      .filter(
        (m) =>
          m.prescriberId === prescriberId &&
          m.status !== 'stopped' &&
          !claimed.has(m.id) &&
          sameMedicine(m.ingredients, ingredients),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))[0];

  const save = (medicine: Medicine) => {
    medicines.set(medicine.id, medicine);
    changedMedicines.set(medicine.id, medicine);
  };

  const openConfirmItems = (medicineId: ID) =>
    state.reviewItems.filter(
      (item) =>
        item.kind === 'confirm_medicine' && item.resolvedAt === null && item.medicineIds.includes(medicineId),
    );

  const closeConfirmItems = (medicineId: ID, resolution: 'still_taking' | 'dismissed') => {
    for (const item of openConfirmItems(medicineId)) {
      changedItems.set(item.id, { ...item, resolvedAt: ctx.now, resolution });
    }
  };

  const create = (line: PrescriptionLine): Medicine => {
    const medicine: Medicine = {
      id: ctx.newId('medicine', line.id),
      profileId: state.profile.id,
      productName: line.productName,
      ingredients: line.ingredients,
      form: line.form,
      dosesPerDay: line.dosesPerDay,
      instruction: line.instruction,
      prescriberId,
      status: 'confirmed_current',
      origin: 'prescription',
      sourceDocumentId: documentId,
      fieldState: 'confirmed',
      replacedByMedicineId: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    save(medicine);
    claimed.add(medicine.id);
    return medicine;
  };

  const addedNames = rows.filter((r) => r.kind === 'added' && r.latest).map((r) => r.latest!.productName);

  for (const row of rows) {
    if (row.kind === 'review') {
      const old = current(row.previous!.ingredients);
      if (!old) continue;
      claimed.add(old.id);
      if (old.status !== 'needs_confirmation') {
        save({ ...old, status: 'needs_confirmation', updatedAt: ctx.now });
        plan.events.push(
          makeEvent(old, 'flagged_for_review', `Not on the prescription of ${who}, ${when}`, documentId, ctx),
        );
      }
      if (openConfirmItems(old.id).length === 0) {
        const adds = addedNames.length > 0 ? `, which adds ${joinNames(addedNames)}` : '';
        plan.reviewItems.push({
          id: ctx.newId('reviewItem', `confirm_medicine:${old.id}`),
          profileId: state.profile.id,
          kind: 'confirm_medicine',
          title: `${pronouns.be === 'is' ? 'Is' : 'Are'} ${pronouns.subject} still taking ${old.productName}?`,
          body: `It is in the home inventory, but it is missing from ${who}'s prescription of ${dayAndMonth(doc.documentDate)}${adds}.`,
          medicineIds: [old.id],
          documentId,
          createdAt: ctx.now,
          resolvedAt: null,
          resolution: null,
        });
      }
      continue;
    }

    const line = row.latest!;
    const old = current(row.previous?.ingredients ?? line.ingredients);

    if (!old) {
      // Nothing current to compare with. An unchanged line whose medicine the caregiver
      // has stopped stays stopped; anything else is new information from the prescriber.
      if (row.kind === 'unchanged') continue;
      const medicine = create(line);
      plan.events.push(
        row.kind === 'changed'
          ? makeEvent(
              medicine,
              strengthDiffers(row.previous!, line) ? 'strength_changed' : 'instruction_changed',
              row.note,
              documentId,
              ctx,
            )
          : makeEvent(medicine, 'added', `Added from the prescription of ${who}, ${when}`, documentId, ctx),
      );
      continue;
    }

    claimed.add(old.id);
    if (linesIdentical(old, line)) {
      // Already on the list exactly as written. If a question was open about it, the
      // prescription answers it.
      if (old.status === 'needs_confirmation') {
        save({ ...old, status: 'confirmed_current', updatedAt: ctx.now });
        plan.events.push(makeEvent(old, 'confirmed', `On the prescription of ${who}, ${when}`, documentId, ctx));
        closeConfirmItems(old.id, 'still_taking');
      }
      continue;
    }

    const medicine = create(line);
    save({ ...old, status: 'stopped', replacedByMedicineId: medicine.id, updatedAt: ctx.now });
    plan.events.push(makeEvent(old, 'replaced', `Replaced by ${medicine.productName}`, documentId, ctx));
    plan.events.push(
      makeEvent(
        medicine,
        strengthDiffers(old, line) ? 'strength_changed' : 'instruction_changed',
        describeChange(old, line),
        documentId,
        ctx,
      ),
    );
    closeConfirmItems(old.id, 'dismissed');
  }

  plan.medicines.push(...changedMedicines.values());
  plan.reviewItems.push(...changedItems.values());
  return plan;
}
