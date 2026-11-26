// The reported routine: what the patient takes, as the user reports it (overview 9.4).
// Pure: plain data in, a plan out; ids and time passed in. Every change is an event that
// records the entry before and after, so it can be undone.
import {
  ServiceError,
  type ExtractedLine,
  type FieldEvidence,
  type HealthEntry,
  type ID,
  type ISODateTime,
  type PrescriptionLine,
  type Profile,
  type RoutineEvent,
  type RoutineEventType,
  type RoutineMedicine,
  type RoutineMedicineInput,
  type RoutineSource,
  type RoutineStatus,
} from '../../../contract/types';
import { describeChange } from '../../rules/diff';
import { normalizeIngredientName, normalizeIngredients } from '../../rules/normalize';
import { applyEvidence, lineVerified } from './verify';

export interface RuleContextV2 {
  now: ISODateTime;
  newId(): ID;
}

/** What to store. Rows with a known id replace it; `deleteIds` removes routine entries. */
export interface RoutinePlan {
  upserts: RoutineMedicine[];
  deleteIds: ID[];
  events: RoutineEvent[];
}

export const emptyRoutinePlan = (): RoutinePlan => ({ upserts: [], deleteIds: [], events: [] });
export const writesRoutine = (plan: RoutinePlan) => plan.upserts.length > 0 || plan.deleteIds.length > 0;

export function routineEvent(
  type: RoutineEventType,
  before: RoutineMedicine | null,
  after: RoutineMedicine | null,
  detail: string,
  ctx: RuleContextV2,
  links: { documentId?: ID | null; proposalId?: ID | null; undoesEventId?: ID | null; subject?: RoutineMedicine } = {},
): RoutineEvent {
  // The entry the event is about; given explicitly when it exists neither before nor after.
  const entry = (after ?? before ?? links.subject)!;
  return {
    id: ctx.newId(),
    profileId: entry.profileId,
    medicineId: entry.id,
    type,
    at: ctx.now,
    documentId: links.documentId ?? null,
    proposalId: links.proposalId ?? null,
    before,
    after,
    undoesEventId: links.undoesEventId ?? null,
    detail,
  };
}

function cleanInput(input: RoutineMedicineInput, opts: { allowUnknownStrength?: boolean } = {}): RoutineMedicineInput {
  const productName = input.productName.trim().replace(/\s+/g, ' ');
  if (!productName) throw new ServiceError('unknown', 'Please enter the medicine name.');
  if (input.dosesPerDay !== null && !(Number.isFinite(input.dosesPerDay) && input.dosesPerDay > 0)) {
    throw new ServiceError('unknown', 'How many per day must be a number above zero, or left empty.');
  }
  for (const i of input.ingredients) {
    if (opts.allowUnknownStrength && i.strength === 0) continue;
    if (!(Number.isFinite(i.strength) && i.strength > 0)) throw new ServiceError('unknown', 'Each strength must be a number above zero.');
  }
  return {
    productName,
    ingredients: normalizeIngredients(input.ingredients),
    form: input.form,
    dosesPerDay: input.dosesPerDay,
    instruction: input.instruction.trim(),
  };
}

export function newEntry(
  profileId: ID,
  input: RoutineMedicineInput,
  status: RoutineStatus,
  source: RoutineSource,
  links: { prescriberId: ID | null; documentId: ID | null },
  ctx: RuleContextV2,
  opts: { allowUnknownStrength?: boolean } = {},
): RoutineMedicine {
  const clean = cleanInput(input, opts);
  return {
    id: ctx.newId(),
    profileId,
    ...clean,
    status,
    source,
    prescriberId: links.prescriberId,
    sourceDocumentId: links.documentId,
    replacedByMedicineId: null,
    lastConfirmedAt: status === 'taking' ? ctx.now : null,
    legacyStatus: null,
    legacyReviewPending: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/**
 * The verification gate (overview 9.2) for values taken from a document: refused while any
 * critical field of the line still needs verification or was left unknown. Values the user
 * saw and did not flag count as reviewed.
 */
export function assertLineReviewable(evidence: readonly FieldEvidence[], lineIndex: number): void {
  const blocking = evidence.filter((e) => e.lineIndex === lineIndex && (e.status === 'needs_verification' || e.status === 'unknown'));
  if (blocking.length > 0) {
    throw new ServiceError('verification_required', 'Check the highlighted value first.');
  }
}

/** Marks every 'extracted' value as confirmed by the user, who saw them all (a pack photo). */
export function confirmExtracted(evidence: readonly FieldEvidence[], now: ISODateTime): FieldEvidence[] {
  return evidence.filter((e) => e.status === 'extracted').map((e) => ({ ...e, status: 'user_confirmed' as const, reviewedAt: now }));
}

/** The value a line shows for one evidenced field, in the evidence's own format (overview 9.2). */
function lineValue(line: ExtractedLine, e: FieldEvidence): string | null | undefined {
  const ingredient = e.ingredientIndex === null ? undefined : line.ingredients[e.ingredientIndex];
  switch (e.field) {
    case 'medicine_name': return line.productName.trim();
    case 'ingredient': return ingredient && normalizeIngredientName(ingredient.name);
    case 'strength': return ingredient && String(ingredient.strength);
    case 'unit': return ingredient?.unit;
    case 'frequency': return line.dosesPerDay === null ? null : String(line.dosesPerDay);
    case 'instruction': return line.instruction.trim();
    default: return undefined;
  }
}

/** Two evidence values are the same: numbers compared as numbers, text ignoring outer spaces. */
export const sameValue = (field: FieldEvidence['field'], a: string | null, b: string | null) =>
  a === b || (field === 'strength' || field === 'frequency' ? a !== null && b !== null && Number(a) === Number(b) : (a ?? '').trim() === (b ?? '').trim());

/**
 * Contract request UI v2-1: the evidence is the source of truth for every critical field that
 * has evidence. Saving a prescription reconciles the lines passed in with it:
 * - a value the user already confirmed or corrected keeps its evidence value;
 * - a value still flagged ('needs_verification') or left 'unknown' keeps its evidence value,
 *   whatever the lines say, so an unchecked value can never be slipped in by the caller;
 * - an 'extracted' value the user saw in the line form becomes 'user_confirmed', or
 *   'user_corrected' with the line's value when the user changed it there.
 * Fields without evidence come from the lines. Returns the lines rebuilt from the evidence
 * and the evidence rows that changed.
 */
export function reconcileSavedLines(
  input: readonly ExtractedLine[],
  evidence: readonly FieldEvidence[],
  now: ISODateTime,
): { lines: ExtractedLine[]; changed: FieldEvidence[] } {
  const byIndex = new Map(input.map((l) => [l.lineIndex, l]));
  const changed: FieldEvidence[] = [];
  for (const e of evidence) {
    const line = e.lineIndex === null ? undefined : byIndex.get(e.lineIndex);
    if (!line || e.status !== 'extracted') continue;
    const shown = lineValue(line, e);
    const edited = shown !== undefined && !sameValue(e.field, shown, e.value);
    changed.push(edited ? { ...e, value: shown, status: 'user_corrected', reviewedAt: now } : { ...e, status: 'user_confirmed', reviewedAt: now });
  }
  const merged = evidence.map((e) => changed.find((c) => c.id === e.id) ?? e);

  // Flagged and unknown values: the line carries what the evidence says, not what was passed.
  const flagged = (line: ExtractedLine, field: FieldEvidence['field'], ingredientIndex: number | null) =>
    merged.find((e) => e.lineIndex === line.lineIndex && e.field === field && e.ingredientIndex === ingredientIndex && (e.status === 'needs_verification' || e.status === 'unknown'));
  const forced = input.map((line) => {
    const name = flagged(line, 'medicine_name', null);
    const frequency = flagged(line, 'frequency', null);
    const instruction = flagged(line, 'instruction', null);
    return {
      ...line,
      productName: name ? name.value ?? name.raw ?? line.productName : line.productName,
      dosesPerDay: frequency ? (frequency.value === null ? null : Number(frequency.value)) : line.dosesPerDay,
      instruction: instruction ? instruction.value ?? '' : line.instruction,
      ingredients: line.ingredients.map((ingredient, i) => {
        const strength = flagged(line, 'strength', i);
        const ingredientName = flagged(line, 'ingredient', i);
        const unit = flagged(line, 'unit', i);
        return {
          name: ingredientName?.value ?? ingredient.name,
          // An unreadable strength is 0, as when it was read: its evidence says it is not known.
          strength: strength ? (strength.value === null ? 0 : Number(strength.value)) : ingredient.strength,
          unit: (unit?.value as typeof ingredient.unit | null | undefined) ?? ingredient.unit,
        };
      }),
    };
  });
  return { lines: applyEvidence(forced, merged), changed };
}

/** A line is verified when it has no evidence (typed by the user) or all of it was reviewed. */
export function isLineVerified(evidence: readonly FieldEvidence[], line: Pick<PrescriptionLine, 'lineIndex' | 'ingredients'>): boolean {
  if (line.ingredients.length === 0) return false;
  const mine = evidence.filter((e) => e.lineIndex === line.lineIndex);
  return mine.length === 0 || lineVerified(evidence, line.lineIndex);
}

/** Stored lines with the user's corrections applied and their verified flag recomputed. */
export function refreshLines(lines: readonly PrescriptionLine[], evidence: readonly FieldEvidence[]): PrescriptionLine[] {
  const applied = applyEvidence(lines.map((l) => ({ ...l, warnings: [] })), evidence);
  return lines.map((line, i) => {
    const { productName, ingredients, dosesPerDay, instruction } = applied[i];
    const next = { ...line, productName, ingredients: normalizeIngredients(ingredients), dosesPerDay, instruction };
    return { ...next, verified: isLineVerified(evidence, next) };
  });
}

/** A medicine the user reports, with or without a document behind it. */
export function planAdd(
  profileId: ID,
  input: RoutineMedicineInput,
  opts: { status: 'taking' | 'uncertain'; source: RoutineSource; documentId: ID | null },
  ctx: RuleContextV2,
): RoutinePlan {
  const entry = newEntry(profileId, input, opts.status, opts.source, { prescriberId: null, documentId: opts.documentId }, ctx);
  const detail = opts.source === 'from_pack' ? 'Added from a photo of the pack' : 'Added';
  return { upserts: [entry], deleteIds: [], events: [routineEvent('added', null, entry, detail, ctx, { documentId: opts.documentId })] };
}

export function planUpdate(entry: RoutineMedicine, patch: Partial<RoutineMedicineInput>, ctx: RuleContextV2): RoutinePlan {
  const clean = cleanInput({ ...entry, ...patch });
  const after: RoutineMedicine = { ...entry, ...clean, updatedAt: ctx.now };
  const sameValues = JSON.stringify(clean) === JSON.stringify(cleanInput(entry));
  if (sameValues) return emptyRoutinePlan();
  return { upserts: [after], deleteIds: [], events: [routineEvent('changed', entry, after, describeChange(entry, after), ctx)] };
}

const STATUS_EVENT: Record<RoutineStatus, [RoutineEventType, string]> = {
  taking: ['confirmed', 'Confirmed as taken'],
  stopped: ['stopped', 'Marked as no longer taken'],
  uncertain: ['marked_uncertain', 'Marked as not confirmed'],
  not_started: ['not_started', 'Marked as not started'],
};

export function planSetStatus(entry: RoutineMedicine, status: RoutineStatus, ctx: RuleContextV2): RoutinePlan {
  if (entry.status === status && !entry.legacyReviewPending) return emptyRoutinePlan();
  const after: RoutineMedicine = {
    ...entry,
    status,
    legacyReviewPending: false,
    lastConfirmedAt: status === 'taking' ? ctx.now : entry.lastConfirmedAt,
    updatedAt: ctx.now,
  };
  const [type, detail] = entry.status === 'stopped' && status === 'taking' ? (['restarted', 'Taken again'] as const) : STATUS_EVENT[status];
  return { upserts: [after], deleteIds: [], events: [routineEvent(type, entry, after, detail, ctx)] };
}

/** The batch review of migrated entries: each pending entry is either taken or not. */
export function planResolveLegacy(entries: readonly RoutineMedicine[], takingIds: readonly ID[], notTakingIds: readonly ID[], ctx: RuleContextV2): RoutinePlan {
  const plan = emptyRoutinePlan();
  const pending = new Map(entries.filter((e) => e.legacyReviewPending).map((e) => [e.id, e]));
  for (const id of [...takingIds, ...notTakingIds]) {
    if (!pending.has(id)) throw new ServiceError('not_found', 'This medicine is not waiting for review.');
  }
  if (new Set([...takingIds, ...notTakingIds]).size !== takingIds.length + notTakingIds.length) {
    throw new ServiceError('unknown', 'A medicine cannot be both taken and not taken.');
  }
  for (const [ids, status] of [[takingIds, 'taking'], [notTakingIds, 'stopped']] as const) {
    for (const id of ids) {
      const entry = pending.get(id)!;
      const after: RoutineMedicine = {
        ...entry,
        status,
        source: entry.source === 'legacy' ? 'caregiver_reported' : entry.source,
        legacyReviewPending: false,
        lastConfirmedAt: status === 'taking' ? ctx.now : entry.lastConfirmedAt,
        updatedAt: ctx.now,
      };
      plan.upserts.push(after);
      plan.events.push(routineEvent(status === 'taking' ? 'confirmed' : 'stopped', entry, after, status === 'taking' ? 'Confirmed as taken, after the update' : 'Not taken any more, after the update', ctx));
    }
  }
  return plan;
}

/**
 * Undo: restores the entry as it was before the event. A replacement (one decision that
 * stopped one entry and started another) is undone as a whole. Refused with `stale` when a
 * later event changed one of those entries.
 */
export function planUndo(
  target: RoutineEvent,
  events: readonly RoutineEvent[],
  entries: ReadonlyMap<ID, RoutineMedicine>,
  ctx: RuleContextV2,
): RoutinePlan {
  if (target.type === 'undone' || target.type === 'migrated') {
    throw new ServiceError('unknown', 'This change cannot be undone.');
  }
  const group = [target];
  // The other half of a replacement made by the same decision.
  const partner = events.find(
    (e) => e.id !== target.id && e.at === target.at && e.proposalId !== null && e.proposalId === target.proposalId &&
      ((target.type === 'replaced' && e.medicineId === target.after?.replacedByMedicineId) ||
        (e.type === 'replaced' && e.after?.replacedByMedicineId === target.medicineId)),
  );
  if (partner) group.push(partner);
  if (events.some((e) => e.undoesEventId !== null && group.some((g) => g.id === e.undoesEventId))) {
    throw new ServiceError('unknown', 'This change was already undone.');
  }

  const plan = emptyRoutinePlan();
  for (const event of group) {
    const later = events.filter((e) => e.medicineId === event.medicineId && Date.parse(e.at) > Date.parse(event.at) && !group.includes(e));
    if (later.length > 0) {
      throw new ServiceError('stale', 'A later change was made to this medicine. See its history instead.');
    }
    const current = entries.get(event.medicineId) ?? null;
    if (event.before === null) {
      if (current) plan.deleteIds.push(current.id);
    } else {
      plan.upserts.push({ ...event.before, updatedAt: ctx.now });
    }
    plan.events.push(routineEvent('undone', current, event.before, `Undid: ${event.detail}`, ctx, {
      documentId: event.documentId, proposalId: event.proposalId, undoesEventId: event.id,
      // Every event that can be undone has an `after`: only 'undone' events lack one, and they are refused above.
      subject: event.after!,
    }));
  }
  return plan;
}

/** Allergies and history: "No known allergies" is explicit and exclusive with listed allergies. */
export function planHealthAdd(
  existing: readonly HealthEntry[],
  profile: Profile,
  input: Omit<HealthEntry, 'id' | 'profileId' | 'recordedAt'>,
  ctx: RuleContextV2,
): { add: HealthEntry; removeIds: ID[] } {
  const text = input.text.trim().replace(/\s+/g, ' ');
  if (input.noneKnown) {
    if (input.kind !== 'allergy') throw new ServiceError('unknown', '"None known" is only for allergies.');
    if (existing.some((h) => h.kind === 'allergy' && !h.noneKnown)) {
      throw new ServiceError('unknown', 'Remove the listed allergies first.');
    }
  } else if (!text) {
    throw new ServiceError('unknown', 'Please describe it.');
  }
  const duplicate = existing.find((h) => h.kind === input.kind && h.noneKnown === input.noneKnown && h.text.toLowerCase() === text.toLowerCase());
  if (duplicate) return { add: duplicate, removeIds: [] };
  const removeIds = input.kind === 'allergy' && !input.noneKnown ? existing.filter((h) => h.kind === 'allergy' && h.noneKnown).map((h) => h.id) : [];
  return {
    add: { ...input, text: input.noneKnown ? '' : text, id: ctx.newId(), profileId: profile.id, recordedAt: ctx.now },
    removeIds,
  };
}
