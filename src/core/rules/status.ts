// Medicine statuses and the events that record each change (overview spec section 9).
import type {
  ExtractedLine,
  ID,
  Medicine,
  MedicationEvent,
  MedicationEventType,
  MedicineStatus,
} from '../../contract/legacy/types';
import { normalizeIngredients } from './normalize';
import { emptyPlan, type RuleContext, type WritePlan } from './types';

export const ACTIVE_STATUSES: readonly MedicineStatus[] = [
  'found_at_home',
  'confirmed_current',
  'needs_confirmation',
];

/** Active = at home, confirmed, or waiting for an answer. Stopped medicines are not. */
export function isActive(medicine: Pick<Medicine, 'status'>): boolean {
  return ACTIVE_STATUSES.includes(medicine.status);
}

export function makeEvent(
  medicine: Pick<Medicine, 'id' | 'profileId'>,
  type: MedicationEventType,
  detail: string,
  documentId: ID | null,
  ctx: RuleContext,
): MedicationEvent {
  return {
    id: ctx.newId('event', `${type}:${medicine.id}`),
    profileId: medicine.profileId,
    medicineId: medicine.id,
    type,
    at: ctx.now,
    documentId,
    detail,
  };
}

export type LineFields = Pick<
  ExtractedLine,
  'productName' | 'ingredients' | 'form' | 'dosesPerDay' | 'instruction'
>;

const ADDED_DETAIL: Record<Medicine['origin'], string> = {
  home_scan: 'Found at home (scanned pack)',
  manual: 'Added by hand',
  prescription: 'Added from a prescription',
};

/**
 * A medicine added outside the prescription comparison: a scanned pack, or typed by hand.
 * A scan is `found_at_home` with its fields still marked as extracted. Nothing is assumed
 * about whether the patient takes it.
 */
export function planAddMedicine(
  profileId: ID,
  line: LineFields,
  opts: { origin: Medicine['origin']; documentId: ID | null; prescriberId: ID | null },
  ctx: RuleContext,
): WritePlan {
  const medicine: Medicine = {
    id: ctx.newId('medicine', `${opts.origin}:${line.productName}`),
    profileId,
    productName: line.productName.trim(),
    ingredients: normalizeIngredients(line.ingredients),
    form: line.form,
    dosesPerDay: line.dosesPerDay,
    instruction: line.instruction.trim(),
    prescriberId: opts.prescriberId,
    status: opts.origin === 'prescription' ? 'confirmed_current' : 'found_at_home',
    origin: opts.origin,
    sourceDocumentId: opts.documentId,
    fieldState: opts.origin === 'home_scan' ? 'extracted' : 'confirmed',
    replacedByMedicineId: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const plan = emptyPlan();
  plan.medicines.push(medicine);
  plan.events.push(makeEvent(medicine, 'added', ADDED_DETAIL[opts.origin], opts.documentId, ctx));
  return plan;
}

export type MedicinePatch = Partial<
  Pick<Medicine, 'productName' | 'ingredients' | 'form' | 'dosesPerDay' | 'instruction'>
>;

/** The caregiver confirms the patient takes this, optionally correcting its fields. */
export function planConfirmMedicine(
  medicine: Medicine,
  patch: MedicinePatch | undefined,
  ctx: RuleContext,
): WritePlan {
  const updated: Medicine = {
    ...medicine,
    ...patch,
    ingredients: normalizeIngredients(patch?.ingredients ?? medicine.ingredients),
    status: 'confirmed_current',
    fieldState: 'confirmed',
    updatedAt: ctx.now,
  };
  const plan = emptyPlan();
  plan.medicines.push(updated);
  plan.events.push(makeEvent(updated, 'confirmed', 'Confirmed by the caregiver', null, ctx));
  return plan;
}

const STATUS_EVENT: Partial<Record<MedicineStatus, [MedicationEventType, string]>> = {
  stopped: ['marked_stopped', 'Marked as stopped by the caregiver'],
  confirmed_current: ['confirmed', 'Confirmed by the caregiver'],
  needs_confirmation: ['flagged_for_review', 'Flagged for review'],
};

/** A status set directly by the caregiver. Setting the status it already has does nothing. */
export function planSetStatus(medicine: Medicine, status: MedicineStatus, ctx: RuleContext): WritePlan {
  const plan = emptyPlan();
  if (medicine.status === status) return plan;
  plan.medicines.push({ ...medicine, status, updatedAt: ctx.now });
  const event = STATUS_EVENT[status];
  if (event) plan.events.push(makeEvent(medicine, event[0], event[1], null, ctx));
  return plan;
}
