// Applying the user's answers to a contextual review (overview 9.3, effects table). Pure:
// the service loads the state, this returns what to store, the service writes it in one
// transaction. Every routine change is an event with before and after, so it can be undone.
import {
  ServiceError,
  type ID,
  type PrescriptionLine,
  type ProposalChoice,
  type ProposalRow,
  type Question,
  type RoutineMedicine,
  type RowDecision,
  type Visit,
} from '../../../contract/types';
import { describeStrength } from '../../rules/normalize';
import {
  buildProposal,
  GATED_CHOICES,
  isFrozen,
  type ProposalInput,
  type StoredProposal,
} from './proposal';
import { emptyRoutinePlan, newEntry, routineEvent, type RoutinePlan, type RuleContextV2 } from './routine';

export interface DecideInput {
  proposal: StoredProposal;
  decisions: readonly RowDecision[];
  expectedRevision: number;
  currentRevision: number;
  /** Every routine entry of the profile, by id. */
  entries: ReadonlyMap<ID, RoutineMedicine>;
  /** The next visit, if there is one: ask_doctor adds its question there. */
  nextVisit: Visit | null;
  /** Recomputes the proposal against a routine, keeping its decisions. */
  rebuild: (proposal: StoredProposal, routine: RoutineMedicine[]) => StoredProposal;
}

export interface DecideResult {
  proposal: StoredProposal;
  plan: RoutinePlan;
  /** Routine entries as they are after the decisions, in the order they were changed. */
  changed: RoutineMedicine[];
  visit: Visit | null;
  questionsAdded: Question[];
}

export const STALE_MESSAGE = 'The medicine list changed since this review was prepared. It has been refreshed.';

const CHOICE_DETAIL: Partial<Record<ProposalChoice, string>> = {
  started: 'Started, from the prescription',
  not_started: 'Prescribed, not started',
  kept_previous: 'Kept the previous dose',
  still_taking: 'Still taken',
  not_taking: 'Not taken any more',
  ask_doctor: 'Not confirmed: asking the doctor',
};

/** The question for the doctor, in plain words, about this row. */
export function questionText(row: ProposalRow): string {
  const line = row.line?.productName ?? '';
  const medicine = row.medicine?.productName ?? '';
  switch (row.kind) {
    case 'changed':
      return `${medicine} or ${line} (${row.note}): which should be taken?`;
    case 'new':
      return `Should ${line} be started?`;
    case 'not_mentioned':
      return `${medicine} was not on the prescription. Should it still be taken?`;
    default:
      return medicine ? `Is ${line} the same medicine as ${medicine}?` : `Which medicine is "${line}"?`;
  }
}

const valuesOf = (line: PrescriptionLine) => ({
  productName: line.productName,
  ingredients: line.ingredients,
  form: line.form,
  dosesPerDay: line.dosesPerDay,
  instruction: line.instruction,
});

export function planDecisions(input: DecideInput, ctx: RuleContextV2): DecideResult {
  if (input.expectedRevision !== input.currentRevision) throw new ServiceError('stale', STALE_MESSAGE);

  let proposal: StoredProposal = structuredClone(input.proposal);
  const plan = emptyRoutinePlan();
  const entries = new Map(input.entries);
  const changed = new Map<ID, RoutineMedicine>();
  const questionsAdded: Question[] = [];
  let visit = input.nextVisit ? structuredClone(input.nextVisit) : null;
  const links = { documentId: proposal.documentId, proposalId: proposal.id };

  const write = (before: RoutineMedicine | null, after: RoutineMedicine, type: Parameters<typeof routineEvent>[0], detail: string) => {
    plan.upserts = [...plan.upserts.filter((m) => m.id !== after.id), after];
    plan.events.push(routineEvent(type, before, after, detail, ctx, links));
    entries.set(after.id, after);
    changed.set(after.id, after);
  };
  const remember = (rowId: ID, medicineIds: ID[]) => {
    proposal.memory!.effects[rowId] = [...new Set([...(proposal.memory!.effects[rowId] ?? []), ...medicineIds])];
  };
  const current = (medicine: RoutineMedicine | null) => (medicine ? entries.get(medicine.id) ?? medicine : null);

  // Every decision is checked before anything is applied.
  for (const decision of input.decisions) {
    const row = proposal.rows.find((r) => r.id === decision.rowId);
    if (!row) throw new ServiceError('not_found', 'This row is not part of this review.');
    if (row.decision === decision.choice) continue;
    if (!row.choices.includes(decision.choice)) throw new ServiceError('unknown', 'This choice is not available for this medicine.');
    if (isFrozen(row)) {
      throw new ServiceError('unknown', 'This medicine was already decided. Undo that change from its history first.');
    }
    if (GATED_CHOICES.includes(decision.choice) && (row.blockedByVerification || !row.line?.verified)) {
      throw new ServiceError('verification_required', 'Check the highlighted value first.');
    }
  }

  for (const decision of input.decisions) {
    const row = proposal.rows.find((r) => r.id === decision.rowId)!;
    if (row.decision === decision.choice) continue; // idempotent: nothing changes, no event
    const choice = decision.choice;
    const medicine = current(row.medicine);
    proposal.memory ??= { matches: {}, effects: {} };

    if (choice === 'same_medicine' || choice === 'different_medicine') {
      // The row is compared again and offered again; the routine is not touched.
      proposal.memory.matches[row.line!.lineIndex] = choice === 'same_medicine' ? medicine!.id : null;
      proposal = input.rebuild(proposal, [...entries.values()]);
      continue;
    }

    switch (choice) {
      case 'started':
      case 'not_started': {
        const status = choice === 'started' ? 'taking' : 'not_started';
        const entry = newEntry(proposal.profileId, valuesOf(row.line!), status, 'from_prescription', { prescriberId: proposal.prescriberId, documentId: proposal.documentId }, ctx, { allowUnknownStrength: choice === 'not_started' });
        write(null, entry, choice === 'started' ? 'added' : 'not_started', CHOICE_DETAIL[choice]!);
        remember(row.id, [entry.id]);
        break;
      }
      case 'started_new': {
        const entry = newEntry(proposal.profileId, valuesOf(row.line!), 'taking', 'from_prescription', { prescriberId: proposal.prescriberId, documentId: proposal.documentId }, ctx);
        const stopped: RoutineMedicine = { ...medicine!, status: 'stopped', replacedByMedicineId: entry.id, legacyReviewPending: false, updatedAt: ctx.now };
        write(medicine, stopped, 'replaced', `Replaced: ${describeStrength(medicine!.ingredients)} to ${describeStrength(entry.ingredients)}`);
        write(null, entry, 'added', `Started, replacing ${medicine!.productName}`);
        remember(row.id, [medicine!.id, entry.id]);
        break;
      }
      case 'kept_previous':
      case 'still_taking': {
        write(medicine, { ...medicine!, status: 'taking', legacyReviewPending: false, lastConfirmedAt: ctx.now, updatedAt: ctx.now }, 'confirmed', CHOICE_DETAIL[choice]!);
        remember(row.id, [medicine!.id]);
        break;
      }
      case 'not_taking': {
        if (row.kind === 'changed' || row.kind === 'not_mentioned') {
          write(medicine, { ...medicine!, status: 'stopped', legacyReviewPending: false, updatedAt: ctx.now }, 'stopped', CHOICE_DETAIL.not_taking!);
          remember(row.id, [medicine!.id]);
        }
        break;
      }
      case 'ask_doctor': {
        if ((row.kind === 'changed' || row.kind === 'not_mentioned') && medicine!.status !== 'uncertain') {
          write(medicine, { ...medicine!, status: 'uncertain', updatedAt: ctx.now }, 'marked_uncertain', CHOICE_DETAIL.ask_doctor!);
          remember(row.id, [medicine!.id]);
        }
        if (visit) {
          const text = questionText(row);
          if (!visit.questions.some((q) => q.text === text)) {
            const question: Question = { id: ctx.newId(), text, source: 'review', medicineId: medicine?.id ?? null, documentId: proposal.documentId };
            visit = { ...visit, questions: [...visit.questions, question] };
            questionsAdded.push(question);
          }
        }
        break;
      }
      case 'skip':
        break;
    }
    proposal.rows = proposal.rows.map((r) => (r.id === row.id ? { ...r, decision: choice, decidedAt: ctx.now } : r));
  }

  const finalProposal = input.rebuild(proposal, [...entries.values()]);
  return { proposal: finalProposal, plan, changed: [...changed.values()], visit: questionsAdded.length > 0 ? visit : null, questionsAdded };
}

/** Recomputes a stored proposal against a routine, keeping its decisions. */
export function rebuildWith(base: Omit<ProposalInput, 'previous' | 'routine'>) {
  return (proposal: StoredProposal, routine: RoutineMedicine[]) => buildProposal({ ...base, routine, previous: proposal });
}
