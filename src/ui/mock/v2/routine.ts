// Routine rules for the v2 mock: revisions, events, field-evidence gate, proposals (overview 9.2 to 9.5).
// Simple, deterministic versions of the core rules; the real ones live in src/core.
import * as T from '../../../contract/types';
import type { MockCtx, StoredProposal } from './state';
import { ACTIVE_FOR_REVIEW, changeNote, firstWord, identical, ingredientKey, isMass, longDate, norm, round3, toMg } from './text';

// ---------- revisions and events ----------

export const revisionOf = (ctx: MockCtx, profileId: T.ID) => ctx.state.revisions.get(profileId) ?? 0;

const bump = (ctx: MockCtx, profileId: T.ID) => ctx.state.revisions.set(profileId, revisionOf(ctx, profileId) + 1);

/** Records one routine event and counts it as one routine write. */
export function recordEvent(
  ctx: MockCtx,
  m: T.RoutineMedicine,
  type: T.RoutineEventType,
  detail: string,
  before: T.RoutineMedicine | null,
  extra: Partial<Pick<T.RoutineEvent, 'documentId' | 'proposalId' | 'undoesEventId'>> = {},
  after: T.RoutineMedicine | null = structuredClone(m),
): T.RoutineEvent {
  const event: T.RoutineEvent = {
    id: ctx.newId(), profileId: m.profileId, medicineId: m.id, type, at: ctx.now(),
    documentId: extra.documentId ?? null, proposalId: extra.proposalId ?? null,
    before, after, undoesEventId: extra.undoesEventId ?? null, detail,
  };
  ctx.state.events.push(event);
  bump(ctx, m.profileId);
  return event;
}

export function getMedicine(ctx: MockCtx, id: T.ID): T.RoutineMedicine {
  const m = ctx.state.routine.find((x) => x.id === id);
  if (!m) throw new T.ServiceError('not_found', 'This medicine is not on this device.');
  return m;
}

export function createEntry(
  ctx: MockCtx,
  profileId: T.ID,
  input: T.RoutineMedicineInput,
  status: T.RoutineStatus,
  source: T.RoutineSource,
  prescriberId: T.ID | null,
  documentId: T.ID | null,
): T.RoutineMedicine {
  const at = ctx.now();
  const m: T.RoutineMedicine = {
    productName: input.productName, ingredients: structuredClone(input.ingredients), form: input.form,
    dosesPerDay: input.dosesPerDay, instruction: input.instruction,
    id: ctx.newId(), profileId, status, source, prescriberId, sourceDocumentId: documentId, replacedByMedicineId: null,
    lastConfirmedAt: status === 'taking' ? at : null, legacyStatus: null, legacyReviewPending: false, createdAt: at, updatedAt: at,
  };
  ctx.state.routine.push(m);
  return m;
}

const STATUS_EVENT: Record<T.RoutineStatus, T.RoutineEventType> = {
  taking: 'confirmed', not_started: 'not_started', uncertain: 'marked_uncertain', stopped: 'stopped',
};

const STATUS_DETAIL: Record<T.RoutineStatus, string> = {
  taking: 'Marked as taking', not_started: 'Marked as not started', uncertain: 'Marked as not sure', stopped: 'Marked as stopped',
};

/** Changes a status with its event. Setting the status an entry already has does nothing (9.4). */
export function changeStatus(
  ctx: MockCtx, m: T.RoutineMedicine, status: T.RoutineStatus, detail?: string,
  extra: Partial<Pick<T.RoutineEvent, 'documentId' | 'proposalId'>> = {},
): boolean {
  if (m.status === status) return false;
  const before = structuredClone(m);
  const type = status === 'taking' && m.status === 'stopped' ? 'restarted' : STATUS_EVENT[status];
  m.status = status;
  m.updatedAt = ctx.now();
  if (status === 'taking') m.lastConfirmedAt = m.updatedAt;
  recordEvent(ctx, m, type, detail ?? STATUS_DETAIL[status], before, extra);
  return true;
}

/**
 * Undo restores the `before` of an event (9.3). Refused with `stale` when a later event changed the
 * same entry. An event that created the entry is undone by removing the entry.
 */
export function undoEvent(ctx: MockCtx, eventId: T.ID): T.RoutineMedicine {
  const { state } = ctx;
  const event = state.events.find((e) => e.id === eventId);
  if (!event) throw new T.ServiceError('not_found', 'This change is not in the history.');
  if (event.type === 'undone' || state.events.some((e) => e.undoesEventId === eventId)) {
    throw new T.ServiceError('stale', 'This change was already undone.');
  }
  const index = state.events.indexOf(event);
  if (state.events.slice(index + 1).some((e) => e.medicineId === event.medicineId)) {
    throw new T.ServiceError('stale', 'A later change was made to this medicine. See the history.');
  }
  const current = state.routine.find((m) => m.id === event.medicineId);
  if (!current) throw new T.ServiceError('not_found', 'This medicine is not on this device.');
  const before = structuredClone(current);
  if (event.before === null) {
    state.routine = state.routine.filter((m) => m.id !== current.id);
    recordEvent(ctx, current, 'undone', `Undid: ${event.detail}`, before, { undoesEventId: eventId }, null);
    return before;
  }
  Object.assign(current, structuredClone(event.before), { updatedAt: ctx.now() });
  recordEvent(ctx, current, 'undone', `Undid: ${event.detail}`, before, { undoesEventId: eventId });
  return current;
}

// ---------- field evidence and the verification gate ----------

const HUMAN: T.FieldStatus[] = ['user_confirmed', 'user_corrected'];

export const evidenceOf = (ctx: MockCtx, documentId: T.ID) => ctx.state.evidence.filter((e) => e.documentId === documentId);

/**
 * Applies reviewed evidence to a line: the evidence wins over the values passed in (contract request
 * v2-1, provisional). When the strength is corrected, the strength as read in the product name
 * ('Aspirin 7? mg') is replaced too.
 */
export function applyEvidence(line: T.ExtractedLine, evidence: T.FieldEvidence[]): T.ExtractedLine {
  const out = structuredClone(line);
  for (const e of evidence) {
    if (e.lineIndex !== line.lineIndex || !HUMAN.includes(e.status) || e.value === null) continue;
    const ingredient = out.ingredients[e.ingredientIndex ?? 0];
    switch (e.field) {
      case 'medicine_name': out.productName = e.value; break;
      case 'ingredient': if (ingredient) ingredient.name = norm(e.value); break;
      case 'strength': {
        const value = Number(e.value);
        if (ingredient && Number.isFinite(value)) {
          ingredient.strength = value;
          if (e.raw && out.productName.includes(e.raw)) out.productName = out.productName.replace(e.raw, `${value} ${ingredient.unit}`);
        }
        break;
      }
      case 'unit': if (ingredient) ingredient.unit = e.value as T.DoseUnit; break;
      case 'frequency': { const v = Number(e.value); out.dosesPerDay = Number.isFinite(v) ? v : out.dosesPerDay; break; }
      case 'instruction': out.instruction = e.value; break;
      default: break;
    }
  }
  if (evidence.some((e) => e.lineIndex === line.lineIndex && e.field === 'strength' && HUMAN.includes(e.status))) {
    out.warnings = out.warnings.filter((w) => !w.startsWith('Strength'));
  }
  return out;
}

/** A line is verified when all its critical fields are confirmed or corrected. A line with no evidence was typed or seeded. */
export const lineVerified = (lineIndex: number, evidence: T.FieldEvidence[]) =>
  evidence.filter((e) => e.lineIndex === lineIndex).every((e) => HUMAN.includes(e.status));

/** Rebuilds a document's saved prescription lines from the lines passed to save and the current evidence. */
export function rebuildLines(ctx: MockCtx, documentId: T.ID): T.PrescriptionLine[] {
  const input = ctx.state.savedInput.get(documentId);
  if (!input) return ctx.state.lines.filter((l) => l.documentId === documentId);
  const evidence = evidenceOf(ctx, documentId);
  const previous = ctx.state.lines.filter((l) => l.documentId === documentId);
  const lines = input.map((raw): T.PrescriptionLine => {
    const l = applyEvidence(raw, evidence);
    return {
      id: previous.find((p) => p.lineIndex === l.lineIndex)?.id ?? ctx.newId(),
      documentId, lineIndex: l.lineIndex, productName: l.productName, ingredients: l.ingredients, form: l.form,
      dosesPerDay: l.dosesPerDay, instruction: l.instruction, verified: lineVerified(l.lineIndex, evidence),
    };
  });
  ctx.state.lines = [...ctx.state.lines.filter((l) => l.documentId !== documentId), ...lines];
  return lines;
}

// ---------- proposals ----------

const CHOICES: Record<T.ProposalRowKind, T.ProposalChoice[]> = {
  new: ['started', 'not_started', 'not_taking', 'ask_doctor', 'skip'],
  changed: ['started_new', 'kept_previous', 'not_taking', 'ask_doctor', 'skip'],
  same: [],
  not_mentioned: ['still_taking', 'not_taking', 'ask_doctor', 'skip'],
  uncertain_match: ['same_medicine', 'different_medicine', 'ask_doctor', 'skip'],
};

/** Choices that write values from the line into the routine: these are behind the gate. */
const WRITES_VALUES: T.ProposalChoice[] = ['started', 'not_started', 'started_new'];

const ORDER: T.ProposalRowKind[] = ['changed', 'new', 'not_mentioned', 'uncertain_match', 'same'];

const lineRowId = (proposalId: T.ID, lineIndex: number) => `${proposalId}-line-${lineIndex}`;
const medRowId = (proposalId: T.ID, medicineId: T.ID) => `${proposalId}-med-${medicineId}`;

function row(
  id: T.ID, kind: T.ProposalRowKind, line: T.PrescriptionLine | null, medicine: T.RoutineMedicine | null, note: string,
): T.ProposalRow {
  return {
    id, kind, line, medicine, asked: kind !== 'same', blockedByVerification: line !== null && !line.verified && kind !== 'same',
    choices: CHOICES[kind], decision: null, decidedAt: null, note,
  };
}

interface Computed { rows: T.ProposalRow[]; passiveIds: T.ID[] }

/** Computes the rows of a proposal against the current routine (9.3). */
export function computeRows(
  ctx: MockCtx, proposalId: T.ID, profileId: T.ID, prescriberId: T.ID | null, lines: T.PrescriptionLine[],
  overrides: StoredProposal['overrides'],
): Computed {
  const active = ctx.state.routine.filter((m) => m.profileId === profileId && ACTIVE_FOR_REVIEW.includes(m.status));
  const used = new Set<T.ID>();
  const rows: T.ProposalRow[] = [];
  const sorted = [...lines].sort((a, b) => a.lineIndex - b.lineIndex);

  for (const line of sorted) {
    const id = lineRowId(proposalId, line.lineIndex);
    const forced = overrides[line.lineIndex];
    if (forced === 'new') {
      rows.push(row(id, 'new', line, null, 'Not in the current routine'));
      continue;
    }
    const forcedMed = forced ? active.find((m) => m.id === forced) : undefined;
    const key = ingredientKey(line.ingredients);
    const candidates = forcedMed ? [forcedMed] : key ? active.filter((m) => !used.has(m.id) && ingredientKey(m.ingredients) === key) : [];
    const match = candidates.find((m) => identical(m, line))
      ?? candidates.find((m) => m.prescriberId === prescriberId)
      ?? candidates[0];
    if (match) {
      used.add(match.id);
      rows.push(identical(match, line)
        ? row(id, 'same', line, match, 'No change')
        : row(id, 'changed', line, match, changeNote(match, line)));
      continue;
    }
    const byName = active.find((m) => !used.has(m.id) && firstWord(m.productName) === firstWord(line.productName));
    if (!key || byName) {
      if (byName) used.add(byName.id);
      rows.push(row(id, 'uncertain_match', line, byName ?? null, byName
        ? `Same name as ${byName.productName}, but the ingredients differ or are unknown`
        : 'The active ingredients could not be read'));
      continue;
    }
    rows.push(row(id, 'new', line, null, 'Not in the current routine'));
  }

  const missing = active.filter((m) => !used.has(m.id));
  const passiveIds: T.ID[] = [];
  const notMentioned: T.ProposalRow[] = [];
  for (const m of missing) {
    if (prescriberId !== null && m.prescriberId === prescriberId) {
      notMentioned.push(row(medRowId(proposalId, m.id), 'not_mentioned', null, m, 'Not on this prescription'));
    } else passiveIds.push(m.id);
  }
  notMentioned.sort((a, b) => a.medicine!.productName.localeCompare(b.medicine!.productName));

  const ordered = ORDER.flatMap((kind) => (kind === 'not_mentioned' ? notMentioned : rows.filter((r) => r.kind === kind)));
  return { rows: ordered, passiveIds };
}

/**
 * Brings a stored proposal up to date: undecided rows are recomputed against the current routine and
 * lines; decided rows are kept as they were answered.
 */
export function refreshProposal(ctx: MockCtx, stored: StoredProposal): T.RoutineProposal {
  const p = stored.proposal;
  const lines = rebuildLines(ctx, p.documentId);
  const { rows, passiveIds } = computeRows(ctx, p.id, p.profileId, p.prescriberId, lines, stored.overrides);
  const decided = new Map(p.rows.filter((r) => r.decision !== null).map((r) => [r.id, r]));
  const merged = rows.map((r) => decided.get(r.id) ?? r);
  for (const [id, r] of decided) if (!merged.some((m) => m.id === id)) merged.push(r);
  p.rows = ORDER.flatMap((kind) => merged.filter((r) => r.kind === kind));
  p.passiveNotMentionedCount = passiveIds.length;
  p.routineRevision = revisionOf(ctx, p.profileId);
  return p;
}

export const noDifferences = (rows: T.ProposalRow[]) => rows.every((r) => r.kind === 'same');

const firstName = (ctx: MockCtx, profileId: T.ID) =>
  ctx.state.profiles.find((p) => p.id === profileId)?.name.split(' ')[0] ?? 'the patient';

function questionFor(ctx: MockCtx, p: T.RoutineProposal, r: T.ProposalRow): string {
  const who = firstName(ctx, p.profileId);
  const doc = ctx.state.documents.find((d) => d.id === p.documentId);
  const on = doc?.clinicalDate ? ` of ${longDate(doc.clinicalDate)}` : '';
  switch (r.kind) {
    case 'changed': return `The prescription${on} says ${r.line!.productName}. Should ${who} take it instead of ${r.medicine!.productName}?`;
    case 'new': return `Should ${who} start ${r.line!.productName}, as on the prescription${on}?`;
    case 'not_mentioned': return `${r.medicine!.productName} is not on the prescription${on}. Should ${who} keep taking it?`;
    default: return `Is ${r.line?.productName ?? 'this medicine'} the same medicine as ${r.medicine?.productName ?? 'one already taken'}?`;
  }
}

export interface DecideResult { proposal: T.RoutineProposal; changed: T.RoutineMedicine[]; questionsAdded: T.Question[] }

/** Applies decisions in one go (9.3). Validates every decision before changing anything. */
export function decide(
  ctx: MockCtx, stored: StoredProposal, decisions: T.RowDecision[], options: { gateAll: boolean },
): DecideResult {
  const { state } = ctx;
  const p = stored.proposal;
  const work = decisions.map((d) => {
    const r = p.rows.find((x) => x.id === d.rowId);
    if (!r) throw new T.ServiceError('not_found', 'This row is no longer in the review.');
    if (!r.choices.includes(d.choice)) throw new T.ServiceError('unknown', 'This answer is not available for this medicine.');
    if (r.decision !== null && r.decision !== d.choice && r.decision !== 'skip') {
      throw new T.ServiceError('unknown', 'This medicine was already answered. Use Undo in its history to change it.');
    }
    if (WRITES_VALUES.includes(d.choice) && (r.blockedByVerification || options.gateAll)) {
      throw new T.ServiceError('verification_required', 'Check the highlighted value first.');
    }
    if (d.choice === 'same_medicine' && !r.medicine) {
      throw new T.ServiceError('unknown', 'Choose the medicine it is the same as.');
    }
    return { r, choice: d.choice };
  });

  const changed = new Map<T.ID, T.RoutineMedicine>();
  const questionsAdded: T.Question[] = [];
  const at = ctx.now();
  const extra = { documentId: p.documentId, proposalId: p.id };
  const prescriberName = state.prescribers.find((x) => x.id === p.prescriberId)?.name;
  const startedDetail = prescriberName ? `Started, as on the prescription of ${prescriberName}` : 'Started, as on the prescription';
  const visit = nextVisit(ctx, p.profileId);

  for (const { r, choice } of work) {
    if (r.decision === choice) continue; // idempotent: nothing changes, no event
    const line = r.line;
    const med = r.medicine ? state.routine.find((m) => m.id === r.medicine!.id) ?? null : null;
    const fromLine = (status: T.RoutineStatus) =>
      createEntry(ctx, p.profileId, line!, status, 'from_prescription', p.prescriberId, p.documentId);

    switch (choice) {
      case 'started': {
        const m = fromLine('taking');
        recordEvent(ctx, m, 'added', startedDetail, null, extra);
        changed.set(m.id, m);
        break;
      }
      case 'not_started': {
        const m = fromLine('not_started');
        recordEvent(ctx, m, 'not_started', 'Prescribed, not started', null, extra);
        changed.set(m.id, m);
        break;
      }
      case 'started_new': {
        const m = fromLine('taking');
        if (med) {
          const before = structuredClone(med);
          Object.assign(med, { status: 'stopped', replacedByMedicineId: m.id, updatedAt: at });
          recordEvent(ctx, med, 'replaced', `Replaced by ${m.productName}`, before, extra);
          changed.set(med.id, med);
        }
        recordEvent(ctx, m, 'changed', med ? changeNote(med, m) : startedDetail, null, extra);
        changed.set(m.id, m);
        break;
      }
      case 'kept_previous':
      case 'still_taking': {
        if (med) {
          const before = structuredClone(med);
          // "Still taking" is the user's confirmation, so an unconfirmed entry becomes taking.
          Object.assign(med, { lastConfirmedAt: at, updatedAt: at, status: 'taking' });
          recordEvent(ctx, med, 'confirmed', choice === 'kept_previous' ? `Kept ${med.productName}` : 'Still taking', before, extra);
          changed.set(med.id, med);
        }
        break;
      }
      case 'not_taking':
        if (med && r.kind !== 'new' && changeStatus(ctx, med, 'stopped', 'Not taking it', extra)) changed.set(med.id, med);
        break;
      case 'ask_doctor': {
        if (visit) {
          const q: T.Question = {
            id: ctx.newId(), text: questionFor(ctx, p, r), source: 'review',
            medicineId: med?.id ?? null, documentId: p.documentId,
          };
          visit.questions.push(q);
          questionsAdded.push(q);
        }
        if (med && (r.kind === 'changed' || r.kind === 'not_mentioned')
          && changeStatus(ctx, med, 'uncertain', 'Not sure; question saved for the doctor', extra)) {
          changed.set(med.id, med);
        }
        break;
      }
      case 'same_medicine':
        stored.overrides[line!.lineIndex] = r.medicine!.id;
        continue; // offered again, undecided
      case 'different_medicine':
        stored.overrides[line!.lineIndex] = 'new';
        continue;
      case 'skip':
        break;
    }
    r.decision = choice;
    r.decidedAt = at;
  }

  refreshProposal(ctx, stored);
  if (p.rows.filter((r) => r.asked).every((r) => r.decision !== null)) p.status = 'reviewed';
  else if (p.status === 'dismissed') p.status = 'open';
  return { proposal: p, changed: [...changed.values()], questionsAdded };
}

// ---------- visits ----------

export function nextVisit(ctx: MockCtx, profileId: T.ID): T.Visit | null {
  const today = ctx.today(profileId);
  return ctx.state.visits
    .filter((v) => v.profileId === profileId && v.at.slice(0, 10) >= today)
    .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
}

// ---------- totals (9.5) ----------

export function ingredientTotals(ctx: MockCtx, profileId: T.ID): T.IngredientTotal[] {
  const active = ctx.state.routine.filter((m) => m.profileId === profileId && (m.status === 'taking' || m.status === 'uncertain'));
  const groups = new Map<string, T.RoutineMedicine[]>();
  for (const m of active) {
    for (const name of new Set(m.ingredients.map((i) => norm(i.name)).filter(Boolean))) {
      groups.set(name, [...(groups.get(name) ?? []), m]);
    }
  }
  return [...groups.entries()]
    .filter(([, meds]) => meds.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ingredient, meds]) => {
      const items = meds.map((m) => ({ m, i: m.ingredients.find((x) => norm(x.name) === ingredient)! }));
      const units = new Set(items.map(({ i }) => i.unit));
      const allMass = items.every(({ i }) => isMass(i.unit));
      const unit: T.DoseUnit = units.size === 1 ? items[0].i.unit : allMass ? 'mg' : items[0].i.unit;
      const comparable = units.size === 1 || allMass;
      const amount = (i: T.Ingredient) => (units.size === 1 ? i.strength : toMg(i.strength, i.unit));
      const parts = items.map(({ m, i }) => ({
        medicineId: m.id, productName: m.productName,
        perDay: m.dosesPerDay === null || !comparable ? 0 : round3(amount(i) * m.dosesPerDay),
      }));
      const complete = comparable && meds.every((m) => m.dosesPerDay !== null);
      return { ingredient, unit, perDay: complete ? round3(parts.reduce((s, x) => s + x.perDay, 0)) : 0, parts, complete };
    });
}

export const DUPLICATE_WORDING =
  'These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.';
