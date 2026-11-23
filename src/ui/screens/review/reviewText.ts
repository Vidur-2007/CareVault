// Wording and matching for Review changes (UI spec 4.7, overview 9.3). Pure, unit-tested.
import type {
  FieldEvidence, Ingredient, Profile, ProposalChoice, ProposalRow, ProposalRowKind, Question, RoutineEvent, RoutineMedicine,
} from '../../../contract/types';
import type { PillSpec } from '../../components/pills';
import { pronounsFor } from '../../lib/pronouns';

/** Choices that write values from the prescription line into the routine: behind the verification gate (9.2). */
export const WRITES_VALUES: ProposalChoice[] = ['started', 'not_started', 'started_new'];

/** Asked rows in the order of the spec: changed, new, not_mentioned, uncertain_match. */
export const ASKED_ORDER: ProposalRowKind[] = ['changed', 'new', 'not_mentioned', 'uncertain_match'];

/** The proposal pills of UI spec section 2. */
export function kindPill(row: Pick<ProposalRow, 'kind' | 'line' | 'medicine'>): PillSpec {
  switch (row.kind) {
    case 'new': return { tone: 'blue', label: 'Newly prescribed' };
    case 'changed': {
      const a = row.medicine ? strengthText(row.medicine.ingredients) : null;
      const b = row.line ? strengthText(row.line.ingredients) : null;
      return { tone: 'amber', label: a && b && a !== b ? 'Different strength' : 'Different instructions' };
    }
    case 'same': return { tone: 'grey', label: 'No change' };
    case 'not_mentioned': return { tone: 'outline', label: 'Not on this prescription' };
    default: return { tone: 'amber', label: 'Possible match' };
  }
}

/** "Telmisartan 80 mg" → "Telmisartan"; "Aspirin 7? mg" → "Aspirin". Names without a strength are kept. */
export function baseName(productName: string): string {
  const base = productName.replace(/\s+\d[\d.,?]*\s*(mg|mcg|µg|g|ml|iu|units?|%)(\s.*)?$/i, '').trim();
  return base || productName.trim();
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** "80 mg", "500 mg + 125 mg"; null when no ingredient is known. */
export function strengthText(ingredients: Ingredient[]): string | null {
  return ingredients.length ? ingredients.map((i) => `${num(i.strength)} ${i.unit}`).join(' + ') : null;
}

type Dose = Pick<RoutineMedicine, 'ingredients' | 'dosesPerDay' | 'instruction'>;

const perDay = (n: number | null) => (n === null ? null : n === 1 ? 'once a day' : n === 2 ? 'twice a day' : `${n} times a day`);

/** What differs between the routine entry and the line, as two short values: ["40 mg", "80 mg"]. */
export function doseValues(medicine: Dose, line: Dose): [string, string] | null {
  const a = strengthText(medicine.ingredients);
  const b = strengthText(line.ingredients);
  if (a && b && a !== b) return [a, b];
  const pa = perDay(medicine.dosesPerDay);
  const pb = perDay(line.dosesPerDay);
  if (pa && pb && pa !== pb) return [pa, pb];
  if (medicine.instruction && line.instruction && medicine.instruction !== line.instruction) return [medicine.instruction, line.instruction];
  return null;
}

/** The wording for the patient: "he", "she", "they", or "you"/"I" for "Myself" (UI spec 4.7). */
export interface Voice {
  /** Questions: "Is he", "Are they", "Are you". */
  is: string;
  /** Questions: "Has he", "Have they", "Have you". */
  has: string;
  /** Answers: "he takes", "they take", "I take". */
  takes: string;
  /** Answers: "he has", "they have", "I have". */
  hasDone: string;
  /** Answers: "He is not", "They are not", "I am not". */
  isNot: string;
}

export function voiceFor(profile: Pick<Profile, 'relation'>): Voice {
  if (profile.relation === 'Myself') return { is: 'Are you', has: 'Have you', takes: 'I take', hasDone: 'I have', isNot: 'I am not' };
  const p = pronounsFor(profile.relation);
  if (p.subject === 'they') return { is: 'Are they', has: 'Have they', takes: 'they take', hasDone: 'they have', isNot: 'They are not' };
  const S = p.subject[0].toUpperCase() + p.subject.slice(1);
  return { is: `Is ${p.subject}`, has: `Has ${p.subject}`, takes: `${p.subject} takes`, hasDone: `${p.subject} has`, isNot: `${S} is not` };
}

/** The name a row is about: the routine entry's for not_mentioned, otherwise the line's. */
export function rowName(row: Pick<ProposalRow, 'kind' | 'line' | 'medicine'>): string {
  const name = row.kind === 'not_mentioned' ? row.medicine?.productName : row.line?.productName ?? row.medicine?.productName;
  return baseName(name ?? 'This medicine');
}

/** The question on each card, exactly as in UI spec 4.7. */
export function questionFor(row: ProposalRow, v: Voice): string {
  const name = rowName(row);
  switch (row.kind) {
    case 'changed': return `${v.is} taking ${name} as on this prescription?`;
    case 'new': return `${v.has} started taking ${name}?`;
    case 'not_mentioned': return `${name} was not on this prescription. That does not mean it should be stopped. ${v.is} still taking it?`;
    default: return 'These may be the same medicine, but CareVault could not confirm it.';
  }
}

/** The label of each choice, exactly as in UI spec 4.7. */
export function choiceLabel(row: ProposalRow, choice: ProposalChoice, v: Voice): string {
  const dose = row.medicine && row.line ? doseValues(row.medicine, row.line) : null;
  switch (choice) {
    case 'started_new': return `Yes, ${v.hasDone} started ${dose ? dose[1] : 'the new dose'}`;
    case 'kept_previous': return `No, still ${dose ? dose[0] : 'the previous dose'}`;
    case 'started': return `Yes, ${v.takes} it`;
    case 'not_started': return 'Not started yet';
    case 'still_taking': return 'Yes, still taking';
    case 'not_taking': return row.kind === 'not_mentioned' ? `No, ${v.hasDone} stopped` : `${v.isNot} taking it`;
    case 'same_medicine': return 'Same medicine';
    case 'different_medicine': return 'Different medicine';
    case 'ask_doctor': return 'Not sure, ask the doctor';
    case 'skip': return 'Skip';
  }
}

/** The choices shown on a card: blocked rows lose the ones that write values; "Same medicine" needs an entry. */
export function shownChoices(row: ProposalRow): ProposalChoice[] {
  return row.choices.filter((c) =>
    !(row.blockedByVerification && WRITES_VALUES.includes(c)) && !(c === 'same_medicine' && !row.medicine));
}

/** Rows offered as cards. Before a save, skipped rows are offered again (that is what reopening is for). */
export function offeredRows(rows: ProposalRow[], includeSkipped: boolean): ProposalRow[] {
  const open = rows.filter((r) => r.asked && (r.decision === null || (includeSkipped && r.decision === 'skip')));
  return ASKED_ORDER.flatMap((kind) => open.filter((r) => r.kind === kind));
}

/** Rows answered earlier with something other than skip. */
export const answeredRows = (rows: ProposalRow[]) => rows.filter((r) => r.asked && r.decision !== null && r.decision !== 'skip');

/**
 * Identifies a row across reloads: the same kind, line and routine entry. A row that changed kind
 * (for example the routine entry was stopped elsewhere) is a different question, so its choice is
 * not carried over.
 */
export const rowKey = (row: Pick<ProposalRow, 'kind' | 'line' | 'medicine'>) =>
  `${row.kind}|${row.line?.lineIndex ?? '-'}|${row.medicine?.id ?? '-'}`;

export interface Held { choice: ProposalChoice; name: string }

/** The held choices that still apply to the rows offered now, by row id, and the names of the ones that no longer do. */
export function reconcile(held: Record<string, Held>, rows: ProposalRow[]): { kept: Map<string, ProposalChoice>; dropped: string[] } {
  const kept = new Map<string, ProposalChoice>();
  const dropped: string[] = [];
  for (const [key, h] of Object.entries(held)) {
    const row = rows.find((r) => rowKey(r) === key);
    if (row && shownChoices(row).includes(h.choice)) kept.set(row.id, h.choice);
    else dropped.push(h.name);
  }
  return { kept, dropped };
}

/** "2 medicines are the same as in the routine". */
export const sameLine = (n: number) =>
  n === 1 ? '1 medicine is the same as in the routine' : `${n} medicines are the same as in the routine`;

/** "3 other medicines in the routine are not on this prescription. Nothing changes for them." */
export const passiveLine = (n: number) =>
  n === 1
    ? '1 other medicine in the routine is not on this prescription. Nothing changes for it.'
    : `${n} other medicines in the routine are not on this prescription. Nothing changes for them.`;

/** The confirmation asked before "He has stopped" and "He is not taking it". */
export function stopConfirmation(row: ProposalRow): { title: string; message: string; confirm: string } {
  if (row.kind === 'new') {
    return {
      title: `Leave ${rowName(row)} out of the routine?`,
      message: 'It is not added to the current medicines. The prescription stays in the records.',
      confirm: 'Leave it out',
    };
  }
  const name = row.medicine?.productName ?? rowName(row);
  return {
    title: `Mark ${name} as stopped?`,
    message: 'This records what you have told CareVault. It does not advise stopping anything. You can undo it after saving.',
    confirm: 'Mark as stopped',
  };
}

/** One sentence per answered row, for the summary after saving: "Telmisartan updated to 80 mg." */
export function summarySentence(row: ProposalRow, choice: ProposalChoice, questionSaved: boolean): string {
  const name = rowName(row);
  const dose = row.medicine && row.line ? doseValues(row.medicine, row.line) : null;
  switch (choice) {
    case 'started_new': return dose ? `${name} updated to ${dose[1]}.` : `${name} updated as on this prescription.`;
    case 'kept_previous': return dose ? `${name} kept at ${dose[0]}.` : `${name} kept as before.`;
    case 'started': return `${name} added.`;
    case 'not_started': return `${name} noted as not started.`;
    case 'not_taking': return row.kind === 'new' ? `${name} not added.` : `${name} marked as stopped.`;
    case 'still_taking': return `${name} confirmed as still taken.`;
    case 'ask_doctor':
      if (row.kind === 'new' || row.kind === 'uncertain_match') {
        return questionSaved ? `Question about ${name} saved for the next visit.` : `${name} unchanged. No visit is planned, so no question was saved.`;
      }
      return questionSaved ? `${name} marked as not sure. Question saved for the next visit.` : `${name} marked as not sure.`;
    case 'same_medicine': return `${name} is the same medicine as ${row.medicine?.productName ?? 'the one in the routine'}.`;
    case 'different_medicine': return `${name} is a different medicine.`;
    case 'skip': return `${name} unchanged.`;
  }
}

/**
 * The routine events a row's decision created, newest first, so they can be undone in that order.
 * An event belongs to the row when it is about the row's routine entry, or created an entry from
 * the row's line.
 */
export function eventsForRow(row: ProposalRow, created: RoutineEvent[], documentId: string): RoutineEvent[] {
  const ids = new Set<string>();
  if (row.medicine) ids.add(row.medicine.id);
  for (const e of created) {
    if (e.before === null && e.after && row.line && e.after.sourceDocumentId === documentId && e.after.productName === row.line.productName) {
      ids.add(e.medicineId);
    }
  }
  return created.filter((e) => ids.has(e.medicineId)).reverse();
}

/** Questions added for a row: by routine entry, or in order for rows without one. */
export function questionsForRows(rows: { row: ProposalRow; choice: ProposalChoice }[], added: Question[]): Map<string, Question[]> {
  const out = new Map<string, Question[]>();
  const rest = [...added];
  for (const { row, choice } of rows) {
    if (choice !== 'ask_doctor') continue;
    const i = rest.findIndex((q) => (row.medicine ? q.medicineId === row.medicine.id : q.medicineId === null));
    if (i < 0) continue;
    out.set(row.id, [rest[i]]);
    rest.splice(i, 1);
  }
  return out;
}

const FIELD_WORD: Partial<Record<FieldEvidence['field'], string>> = {
  strength: 'strength', unit: 'unit', frequency: 'dose', medicine_name: 'name', ingredient: 'ingredient', instruction: 'instruction',
};

/** "Check the strength first" when one kind of value is flagged, otherwise "Check the values first". */
export function blockedText(flagged: FieldEvidence[]): { action: string; detail: string } {
  const words = [...new Set(flagged.map((e) => FIELD_WORD[e.field] ?? 'value'))];
  const what = words.length === 1 ? words[0] : 'values';
  const raw = flagged.find((e) => e.raw)?.raw;
  return {
    action: `Check the ${what} first`,
    detail: `${raw ? `It reads “${raw}” on the original. ` : ''}Check this ${what === 'values' ? 'value' : what}, then come back to the review. Nothing is added until it is checked.`,
  };
}
