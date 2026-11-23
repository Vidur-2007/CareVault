// Pure helpers for "Add a record" (UI spec 4.4) and "Check the values" (4.6). Unit-tested.
//
// Field values follow contract request v2-1 (proposed): strength is a decimal with no unit, unit is a
// DoseUnit, frequency is doses per day, document_date is YYYY-MM-DD, names are text.
import type {
  CriticalField, DocumentKind, DoseUnit, ExtractedLine, FieldDecision, FieldEvidence, FieldStatus, ISODate, Prescriber,
} from '../../../contract/types';

export const FIELD_LABEL: Record<CriticalField, string> = {
  medicine_name: 'Medicine name',
  ingredient: 'Active ingredient',
  strength: 'Strength',
  unit: 'Unit',
  frequency: 'Doses a day',
  instruction: 'Instructions',
  document_date: 'Date on the document',
  patient_name: 'Patient name',
};

export const DOSE_UNITS: DoseUnit[] = ['mg', 'mcg', 'g', 'ml', 'IU'];

/** "Strength not clear" for a flagged field, "Strength read automatically" for an unflagged one. */
export function fieldTitle(e: Pick<FieldEvidence, 'field' | 'status'>): string {
  return e.status === 'needs_verification' ? `${FIELD_LABEL[e.field]} not clear` : `${FIELD_LABEL[e.field]} read automatically`;
}

export const OPEN_STATUSES: FieldStatus[] = ['needs_verification', 'extracted'];
export const isOpen = (e: FieldEvidence) => OPEN_STATUSES.includes(e.status);
export const needsCheck = (fields: FieldEvidence[]) => fields.some((e) => e.status === 'needs_verification');

/** Fields to show, grouped by medicine line (document-level fields first). */
export function groupFields(fields: FieldEvidence[]): { lineIndex: number | null; fields: FieldEvidence[] }[] {
  const keys = [...new Set(fields.map((e) => e.lineIndex))].sort((a, b) => (a === null ? -1 : b === null ? 1 : a - b));
  return keys.map((lineIndex) => ({ lineIndex, fields: fields.filter((e) => e.lineIndex === lineIndex) }));
}

/** "Medicine 4: Aspirin 7? mg" from the line's name evidence. */
export function lineTitle(lineIndex: number | null, all: FieldEvidence[]): string {
  if (lineIndex === null) return 'The document';
  const name = all.find((e) => e.lineIndex === lineIndex && e.field === 'medicine_name');
  const text = name?.value ?? name?.raw;
  return text ? `Medicine ${lineIndex + 1}: ${text}` : `Medicine ${lineIndex + 1}`;
}

export function statusLabel(status: FieldStatus): string {
  switch (status) {
    case 'user_confirmed': return 'Checked';
    case 'user_corrected': return 'Corrected';
    case 'unknown': return 'Left unknown';
    case 'needs_verification': return 'Check this value';
    default: return 'Read automatically';
  }
}

/** Checks a typed correction; returns the value to send, or an error. */
export function parseCorrection(field: CriticalField, input: string, today: ISODate): { value: string } | { error: string } {
  const v = input.trim();
  if (!v) return { error: 'Please type the correct value, or choose Leave unknown.' };
  if (field === 'strength' || field === 'frequency') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return { error: field === 'strength' ? 'Please enter a number, like 75 or 0.5.' : 'Please enter how many doses a day, like 1 or 2.' };
    return { value: String(n) };
  }
  if (field === 'unit') return DOSE_UNITS.includes(v as DoseUnit) ? { value: v } : { error: 'Please choose a unit.' };
  if (field === 'document_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Please enter the date on the document.' };
    if (v > today) return { error: 'The date on the document cannot be in the future.' };
    return { value: v };
  }
  if (v.length > 120) return { error: 'Please use 120 characters or fewer.' };
  return { value: field === 'ingredient' ? v.toLowerCase() : v.replace(/\s+/g, ' ') };
}

const HUMAN: FieldStatus[] = ['user_confirmed', 'user_corrected'];

/**
 * The lines with the user's checks applied, for prescriptions.save and routine.add. A corrected
 * strength also replaces the strength as read in the product name ("Aspirin 7? mg" → "Aspirin 75 mg").
 */
export function linesWithChecks(lines: ExtractedLine[], fields: FieldEvidence[]): ExtractedLine[] {
  return lines.map((line) => {
    const out: ExtractedLine = structuredClone(line);
    for (const e of fields) {
      if (e.lineIndex !== line.lineIndex || !HUMAN.includes(e.status) || e.value === null) continue;
      const ing = out.ingredients[e.ingredientIndex ?? 0];
      switch (e.field) {
        case 'medicine_name': out.productName = e.value; break;
        case 'ingredient': if (ing) ing.name = e.value.toLowerCase(); break;
        case 'unit': if (ing && DOSE_UNITS.includes(e.value as DoseUnit)) ing.unit = e.value as DoseUnit; break;
        case 'strength': {
          const n = Number(e.value);
          if (ing && Number.isFinite(n)) ing.strength = n;
          break;
        }
        case 'frequency': { const n = Number(e.value); if (Number.isFinite(n)) out.dosesPerDay = n; break; }
        case 'instruction': out.instruction = e.value; break;
        default: break;
      }
    }
    // The strength as read inside the name follows the correction.
    const strength = fields.find((e) => e.lineIndex === line.lineIndex && e.field === 'strength' && e.status === 'user_corrected');
    const ing = out.ingredients[strength?.ingredientIndex ?? 0];
    if (strength?.raw && ing && out.productName.includes(strength.raw)) {
      out.productName = out.productName.replace(strength.raw, `${ing.strength} ${ing.unit}`);
    }
    if (strength) out.warnings = out.warnings.filter((w) => !w.startsWith('Strength'));
    return out;
  });
}

const key = (e: Pick<FieldEvidence, 'field' | 'lineIndex' | 'ingredientIndex'>) => `${e.field}:${e.lineIndex}:${e.ingredientIndex}`;

/**
 * "Retake the photo, keeping all decisions": the earlier record's decisions, applied to the same
 * fields of the new photo. A typed correction and "Leave unknown" carry over as they were. "It is
 * right" carries over only when the new photo reads the same value; otherwise that field is
 * checked again, because the value on screen is new.
 */
export function carryDecisions(earlier: FieldEvidence[], fresh: FieldEvidence[]): FieldDecision[] {
  const byKey = new Map(earlier.map((e) => [key(e), e]));
  const out: FieldDecision[] = [];
  for (const e of fresh) {
    if (!isOpen(e)) continue;
    const old = byKey.get(key(e));
    if (!old) continue;
    if (old.status === 'user_corrected' && old.value !== null) out.push({ evidenceId: e.id, action: 'correct', value: old.value });
    else if (old.status === 'unknown') out.push({ evidenceId: e.id, action: 'leave_unknown' });
    else if (old.status === 'user_confirmed' && old.value !== null && old.value === e.value) out.push({ evidenceId: e.id, action: 'confirm' });
  }
  return out;
}

/** Interim rule until contract request v2-3: a record of kind "other" with one medicine line is a pack. */
export const isPack = (kind: DocumentKind, lines: ExtractedLine[]) => kind === 'other' && lines.length === 1;

const nameWords = (name: string) => name.toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Matches a name read on a document ("Dr. K. Rao", "Kavita Rao") to the profile's doctors by surname. */
export function matchPrescriber(readName: string | null, prescribers: Prescriber[]): Prescriber | null {
  if (!readName) return null;
  const words = nameWords(readName);
  if (words.length === 0) return null;
  const candidates = prescribers.filter((p) => nameWords(p.name).at(-1) === words.at(-1));
  if (candidates.length === 1) return candidates[0];
  return candidates.find((p) => nameWords(p.name).join(' ') === words.join(' ')) ?? null;
}
