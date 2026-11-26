// The contextual review (overview 9.3): the saved lines of one prescription compared with
// the profile's reported routine. Pure. Matching is by the set of normalized active
// ingredients only; a brand name alone never makes two medicines the same.
import type {
  ID,
  ISODateTime,
  PrescriptionLine,
  ProposalChoice,
  ProposalRow,
  ProposalRowKind,
  RoutineMedicine,
  RoutineProposal,
  RoutineStatus,
} from '../../../contract/types';
import { describeChange, linesIdentical } from '../../rules/diff';
import { ingredientKey } from '../../rules/normalize';

/** The routine the review compares against: everything not stopped. */
export const REVIEWED_STATUSES: readonly RoutineStatus[] = ['taking', 'uncertain', 'not_started'];
export const inReview = (m: RoutineMedicine) => REVIEWED_STATUSES.includes(m.status);

export const CHOICES: Record<ProposalRowKind, readonly ProposalChoice[]> = {
  new: ['started', 'not_started', 'not_taking', 'ask_doctor', 'skip'],
  changed: ['started_new', 'kept_previous', 'not_taking', 'ask_doctor', 'skip'],
  same: [],
  not_mentioned: ['still_taking', 'not_taking', 'ask_doctor', 'skip'],
  uncertain_match: ['same_medicine', 'different_medicine', 'ask_doctor', 'skip'],
};

/** Choices that store values taken from the line: behind the verification gate. */
export const GATED_CHOICES: readonly ProposalChoice[] = ['started', 'started_new'];

/** Choices after which the row is still compared afresh and can be decided again. */
export const OPEN_CHOICES: readonly ProposalChoice[] = ['skip', 'ask_doctor'];

export const NOTES = {
  new: 'New on this prescription',
  notMentioned: 'Not on this prescription',
  same: 'No change',
  noIngredients: 'The medicine in this line could not be identified',
  nameOnly: (productName: string) => `Same name as ${productName}, but the ingredients differ or are not known`,
} as const;

/** Stored with the proposal, never returned: how the user resolved uncertain matches, and what each decision wrote. */
export interface ProposalMemory {
  /** lineIndex → the routine entry the user said it is (`null`: a different medicine). */
  matches: Record<number, ID | null>;
  /** rowId → routine entries written by its decision, so undo can reopen the row. */
  effects: Record<ID, ID[]>;
}

export type StoredProposal = RoutineProposal & { memory?: ProposalMemory };

export const emptyMemory = (): ProposalMemory => ({ matches: {}, effects: {} });

export function toPublic(stored: StoredProposal): RoutineProposal {
  const { memory: _memory, ...proposal } = stored;
  void _memory;
  return proposal;
}

const lineRowId = (proposalId: ID, lineIndex: number) => `${proposalId}:line:${lineIndex}`;
const medicineRowId = (proposalId: ID, medicineId: ID) => `${proposalId}:medicine:${medicineId}`;

const firstWord = (name: string) => name.trim().toLowerCase().split(/[\s-]+/)[0];

const byName = (a: RoutineMedicine, b: RoutineMedicine) => a.productName.localeCompare(b.productName) || a.id.localeCompare(b.id);

interface Match {
  kind: ProposalRowKind;
  medicine: RoutineMedicine | null;
  note: string;
}

/** Compares one line with one routine entry already known to be the same medicine. */
export function compareWith(line: PrescriptionLine, medicine: RoutineMedicine): Match {
  return linesIdentical(line, medicine)
    ? { kind: 'same', medicine, note: NOTES.same }
    : { kind: 'changed', medicine, note: describeChange(medicine, line) };
}

/**
 * The routine entry a line is about. Several entries with the same ingredients prefer an
 * identical one, then this prescriber's, then the first by name.
 */
export function matchLine(
  line: PrescriptionLine,
  routine: readonly RoutineMedicine[],
  prescriberId: ID | null,
  remembered: ID | null | undefined,
): Match {
  if (remembered !== undefined) {
    const chosen = remembered === null ? undefined : routine.find((m) => m.id === remembered);
    if (chosen) return compareWith(line, chosen);
    if (remembered === null) return { kind: 'new', medicine: null, note: NOTES.new };
  }
  if (line.ingredients.length > 0) {
    const key = ingredientKey(line.ingredients);
    const same = routine.filter((m) => m.ingredients.length > 0 && ingredientKey(m.ingredients) === key).sort(byName);
    if (same.length > 0) {
      const best = same.find((m) => linesIdentical(line, m)) ?? same.find((m) => m.prescriberId === prescriberId) ?? same[0];
      return compareWith(line, best);
    }
  }
  const word = firstWord(line.productName);
  const named = word.length >= 3 ? routine.filter((m) => firstWord(m.productName) === word).sort(byName)[0] : undefined;
  if (named) return { kind: 'uncertain_match', medicine: named, note: NOTES.nameOnly(named.productName) };
  if (line.ingredients.length === 0) return { kind: 'uncertain_match', medicine: null, note: NOTES.noIngredients };
  return { kind: 'new', medicine: null, note: NOTES.new };
}

const KIND_ORDER: readonly ProposalRowKind[] = ['changed', 'new', 'not_mentioned', 'uncertain_match', 'same'];

function rowOrder(a: ProposalRow, b: ProposalRow): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    // Within a kind, rows are all about lines, or (not_mentioned) all about routine entries.
    || (a.line && b.line ? a.line.lineIndex - b.line.lineIndex : byName(a.medicine!, b.medicine!));
}

function choicesFor(kind: ProposalRowKind, medicine: RoutineMedicine | null): ProposalChoice[] {
  // Without a candidate entry there is nothing to call "the same medicine".
  return CHOICES[kind].filter((c) => !(c === 'same_medicine' && medicine === null));
}

function makeRow(id: ID, match: Match, line: PrescriptionLine | null): ProposalRow {
  const blocked = line !== null && match.kind !== 'same' && !line.verified;
  return {
    id,
    kind: match.kind,
    line,
    medicine: match.medicine,
    asked: match.kind !== 'same',
    blockedByVerification: blocked,
    choices: choicesFor(match.kind, match.medicine),
    decision: null,
    decidedAt: null,
    note: match.note,
  };
}

/** A decided row whose decision wrote the routine is kept exactly as it was decided. */
export const isFrozen = (row: ProposalRow) => row.decision !== null && !OPEN_CHOICES.includes(row.decision);

export interface ProposalInput {
  proposalId: ID;
  profileId: ID;
  documentId: ID;
  prescriberId: ID | null;
  lines: readonly PrescriptionLine[];
  routine: readonly RoutineMedicine[];
  routineRevision: number;
  now: ISODateTime;
  /** The proposal stored for this document, if any: its decisions are kept. */
  previous: StoredProposal | null;
}

/**
 * Computes the proposal. Rows already decided with a routine-changing choice are kept as
 * decided; skipped rows keep their skip while their kind is the same; everything else is
 * compared afresh with the current routine and the current (possibly corrected) lines.
 */
export function buildProposal(input: ProposalInput): StoredProposal {
  const { proposalId, prescriberId, previous } = input;
  const memory: ProposalMemory = previous?.memory ? structuredClone(previous.memory) : emptyMemory();
  const before = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  const active = input.routine.filter(inReview);
  const rows: ProposalRow[] = [];
  const mentioned = new Set<ID>();

  const carry = (fresh: ProposalRow): ProposalRow => {
    const old = before.get(fresh.id);
    if (!old || old.decision === null) return fresh;
    return old.kind === fresh.kind && fresh.choices.includes(old.decision) ? { ...fresh, decision: old.decision, decidedAt: old.decidedAt } : fresh;
  };

  for (const line of input.lines) {
    const id = lineRowId(proposalId, line.lineIndex);
    const old = before.get(id);
    if (old && isFrozen(old)) {
      rows.push(old);
      if (old.medicine) mentioned.add(old.medicine.id);
      for (const written of memory.effects[id] ?? []) mentioned.add(written);
      continue;
    }
    const match = matchLine(line, active, prescriberId, memory.matches[line.lineIndex]);
    if (match.medicine) mentioned.add(match.medicine.id);
    // Every entry with the same ingredients is on this prescription, not just the one compared.
    if (line.ingredients.length > 0) {
      const key = ingredientKey(line.ingredients);
      for (const m of active) if (m.ingredients.length > 0 && ingredientKey(m.ingredients) === key) mentioned.add(m.id);
    }
    rows.push(carry(makeRow(id, match, line)));
  }

  // Frozen "not mentioned" rows stay, whatever the routine now says about the entry.
  for (const old of before.values()) {
    if (old.line === null && isFrozen(old) && old.medicine && !mentioned.has(old.medicine.id)) {
      rows.push(old);
      mentioned.add(old.medicine.id);
    }
  }

  let passive = 0;
  for (const medicine of [...active].sort(byName)) {
    if (mentioned.has(medicine.id)) continue;
    if (prescriberId !== null && medicine.prescriberId === prescriberId) {
      rows.push(carry(makeRow(medicineRowId(proposalId, medicine.id), { kind: 'not_mentioned', medicine, note: NOTES.notMentioned }, null)));
    } else {
      passive += 1;
    }
  }

  rows.sort(rowOrder);
  const asked = rows.filter((r) => r.asked);
  // Skipped rows stay undecided; every other answer counts.
  const allDecided = asked.length > 0 && asked.every((r) => r.decision !== null && r.decision !== 'skip');
  return {
    id: proposalId,
    profileId: input.profileId,
    documentId: input.documentId,
    prescriberId,
    createdAt: previous?.createdAt ?? input.now,
    routineRevision: input.routineRevision,
    rows,
    passiveNotMentionedCount: passive,
    status: allDecided ? 'reviewed' : previous?.status === 'dismissed' ? 'dismissed' : 'open',
    memory,
  };
}

/** Nothing to ask: every row is "same" (or there are no rows) and nothing was decided. */
export const hasNothingToAsk = (p: RoutineProposal) => p.rows.every((r) => !r.asked && r.decision === null);

/** The same proposal, ignoring when it was recomputed. */
export function sameProposal(a: StoredProposal, b: StoredProposal): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
