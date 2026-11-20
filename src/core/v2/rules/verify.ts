// Field evidence for the critical fields of a read document (overview section 9.2). Pure:
// plain data in, plain data out; ids and time passed in.
//
// A field needs verification when OCR was unsure, the value is malformed or missing a unit,
// the date is not a real date, the strength disagrees with a manufacturer-level drug
// reference entry, the value came from the cloud reader, or it is a strength, unit or
// frequency read from a photo. Nothing here ever changes a value: it only says what to check.
import type {
  CriticalField,
  DoseUnit,
  ExtractedLine,
  FieldDecision,
  FieldEvidence,
  FieldStatus,
  ID,
  ISODateTime,
} from '../../../contract/types';
import { describeStrength, strengthSignature } from '../../rules/normalize';
import type { ParsedDocument, ParsedIngredient, ParsedLine } from '../reading/parse';

export const CONFIDENCE_THRESHOLD = 0.8;

export const REASONS = {
  unclearPhoto: 'The photo is not clear here.',
  fromPhoto: 'Read from a photo. Please compare it with the original.',
  cloud: 'Read by the cloud reader. Please compare it with the original.',
  unclearDigit: 'A digit could not be read.',
  missingUnit: 'The unit is missing.',
  missingStrength: 'The strength was not found.',
  missingIngredient: 'The ingredient could not be read.',
  fromReference: 'Not printed on the document. Taken from the drug reference.',
  notARealDate: 'This does not read as a real date.',
  otherPatient: 'This name is different from the profile name.',
  differsFromReference: (product: string, strength: string) =>
    `Different from the drug reference for ${product} (${strength}).`,
} as const;

export interface OcrWordInfo {
  text: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface OcrLineInfo {
  page: number;
  text: string;
  confidence: number;
  words: OcrWordInfo[];
}

export interface EvidenceInput {
  profileId: ID;
  documentId: ID;
  source: 'pdf_text' | 'ocr' | 'cloud';
  parsed: ParsedDocument;
  /** OCR lines with word confidence and boxes; empty for text PDFs and the cloud. */
  ocrLines: OcrLineInfo[];
  patientNameRead: string | null;
  patientMatch: 'match' | 'mismatch' | 'not_found';
}

export interface EvidenceContext {
  now: ISODateTime;
  newId(): ID;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim();

/** The OCR line a parsed line came from, if any. */
function ocrLineFor(lines: OcrLineInfo[], page: number, sourceText: string): OcrLineInfo | null {
  const wanted = normalize(sourceText);
  return lines.find((l) => l.page === page && normalize(l.text) === wanted)
    ?? lines.find((l) => l.page === page && normalize(l.text).includes(wanted))
    ?? null;
}

/** Confidence and region of the words that make up `raw` on an OCR line. */
function locate(line: OcrLineInfo | null, raw: string | null): { confidence: number | null; region: FieldEvidence['region'] } {
  if (!line) return { confidence: null, region: null };
  const parts = raw ? normalize(raw).split(' ').filter(Boolean) : [];
  const words = parts.length ? line.words.filter((w) => parts.some((p) => normalize(w.text) === p || normalize(w.text).includes(p))) : [];
  if (words.length === 0) return { confidence: line.confidence, region: null };
  const x = Math.min(...words.map((w) => w.box.x));
  const y = Math.min(...words.map((w) => w.box.y));
  const right = Math.max(...words.map((w) => w.box.x + w.box.width));
  const bottom = Math.max(...words.map((w) => w.box.y + w.box.height));
  return { confidence: Math.min(...words.map((w) => w.confidence)), region: { x, y, width: right - x, height: bottom - y } };
}

const unitText = (raw: string | null) => raw?.match(/(mcg|µg|μg|ug|mg|gm|g|ml|i\.u\.?|iu)\s*$/i)?.[1] ?? null;

/** True when a manufacturer-level reference entry disagrees with the printed strengths. */
function referenceMismatch(line: ParsedLine): string | null {
  const entry = line.reference;
  const printed = line.ingredients.filter((i) => !i.fromReference);
  // Only a manufacturer-level entry is strong enough to flag what was read.
  if (!entry || entry.evidence !== 'manufacturer' || printed.length === 0 || printed.some((i) => i.strength === null || i.unit === null)) return null;
  const read = printed.map((i) => ({ name: i.name, strength: i.strength!, unit: i.unit! }));
  if (strengthSignature(read) === strengthSignature(entry.ingredients)) return null;
  return REASONS.differsFromReference(entry.productName, describeStrength(entry.ingredients));
}

/** Warnings for the line itself, for a reference that is not manufacturer-level. */
export function softReferenceWarning(line: ParsedLine): string | null {
  const entry = line.reference;
  if (!entry || entry.evidence === 'manufacturer') return null;
  const printed = line.ingredients.filter((i) => !i.fromReference && i.strength !== null && i.unit !== null);
  if (printed.length === 0) return null;
  const read = printed.map((i) => ({ name: i.name, strength: i.strength!, unit: i.unit! }));
  if (strengthSignature(read) === strengthSignature(entry.ingredients)) return null;
  return `What was read is not what the drug reference lists for ${entry.productName}, whose entry is not confirmed by the maker. Please check against the pack.`;
}

export function buildEvidence(input: EvidenceInput, ctx: EvidenceContext): FieldEvidence[] {
  const out: FieldEvidence[] = [];
  const photo = input.source === 'ocr';
  const cloud = input.source === 'cloud';

  const push = (
    field: CriticalField,
    lineIndex: number | null,
    ingredientIndex: number | null,
    page: number | null,
    raw: string | null,
    value: string | null,
    reasons: string[],
    located: { confidence: number | null; region: FieldEvidence['region'] },
    alwaysCheckFromPhoto: boolean,
  ) => {
    const all = [...reasons];
    if (cloud) all.push(REASONS.cloud);
    if (photo && located.confidence !== null && located.confidence < CONFIDENCE_THRESHOLD) all.push(REASONS.unclearPhoto);
    if (photo && alwaysCheckFromPhoto && !all.includes(REASONS.unclearPhoto)) all.push(REASONS.fromPhoto);
    const status: FieldStatus = all.length ? 'needs_verification' : 'extracted';
    out.push({
      id: ctx.newId(),
      profileId: input.profileId,
      documentId: input.documentId,
      field,
      lineIndex,
      ingredientIndex,
      page,
      raw,
      value,
      status,
      reasons: [...new Set(all)],
      source: input.source,
      confidence: located.confidence,
      region: located.region,
      reviewedAt: null,
    });
  };

  input.parsed.lines.forEach((line, lineIndex) => {
    const ocr = photo ? ocrLineFor(input.ocrLines, line.page, line.sourceText) : null;
    const mismatch = referenceMismatch(line);
    push('medicine_name', lineIndex, null, line.page, line.productName, line.productName, [], locate(ocr, line.productName), false);

    line.ingredients.forEach((ingredient: ParsedIngredient, ingredientIndex) => {
      const ref = ingredient.fromReference ? [REASONS.fromReference] : [];
      const nameReasons = [...ref, ...(ingredient.name ? [] : [REASONS.missingIngredient])];
      push('ingredient', lineIndex, ingredientIndex, line.page, ingredient.nameRaw, ingredient.name || null, nameReasons, locate(ocr, ingredient.nameRaw), false);

      const strengthReasons: string[] = [...ref];
      if (ingredient.strengthRaw?.includes('?')) strengthReasons.push(REASONS.unclearDigit);
      if (ingredient.strength === null && ingredient.strengthRaw === null) strengthReasons.push(REASONS.missingStrength);
      if (ingredient.unit === null && ingredient.strengthRaw !== null) strengthReasons.push(REASONS.missingUnit);
      if (mismatch) strengthReasons.push(mismatch);
      const strengthValue = ingredient.strength === null ? null : String(ingredient.strength);
      push('strength', lineIndex, ingredientIndex, line.page, ingredient.strengthRaw, strengthValue, strengthReasons, locate(ocr, ingredient.strengthRaw), true);

      const unitReasons = [...ref, ...(ingredient.unit === null ? [REASONS.missingUnit] : [])];
      push('unit', lineIndex, ingredientIndex, line.page, unitText(ingredient.strengthRaw), ingredient.unit, unitReasons, locate(ocr, ingredient.strengthRaw), true);
    });

    if (line.dosesPerDay !== null || line.doseRaw !== null) {
      const value = line.dosesPerDay === null ? null : String(line.dosesPerDay);
      push('frequency', lineIndex, null, line.page, line.doseRaw, value, [], locate(ocr, line.doseRaw), true);
    }
    if (line.instruction) {
      push('instruction', lineIndex, null, line.page, line.doseRaw ?? line.instruction, line.instruction, [], locate(ocr, line.doseRaw), false);
    }
  });

  const parsed = input.parsed;
  if (parsed.clinicalDate || parsed.dateUnclear) {
    const reasons = parsed.dateUnclear ? [REASONS.notARealDate] : [];
    const ocr = photo ? input.ocrLines.find((l) => parsed.dateRaw !== null && normalize(l.text).includes(normalize(parsed.dateRaw))) ?? null : null;
    push('document_date', null, null, ocr?.page ?? null, parsed.dateRaw, parsed.clinicalDate, reasons, locate(ocr, parsed.dateRaw), false);
  }
  if (input.patientNameRead) {
    const reasons = input.patientMatch === 'mismatch' ? [REASONS.otherPatient] : [];
    const ocr = photo ? input.ocrLines.find((l) => normalize(l.text).includes(normalize(input.patientNameRead!))) ?? null : null;
    push('patient_name', null, null, ocr?.page ?? null, input.patientNameRead, input.patientNameRead, reasons, locate(ocr, input.patientNameRead), false);
  }
  return out;
}

const HUMAN: ReadonlySet<FieldStatus> = new Set(['user_confirmed', 'user_corrected', 'unknown']);
const keyOf = (e: Pick<FieldEvidence, 'field' | 'lineIndex' | 'ingredientIndex'>) => `${e.field}|${e.lineIndex}|${e.ingredientIndex}`;

/**
 * Evidence after a re-read: every human decision is kept as it is; fresh automatic evidence
 * replaces the old automatic evidence, except where a human already decided that field.
 */
export function mergeEvidence(existing: readonly FieldEvidence[], fresh: readonly FieldEvidence[]): FieldEvidence[] {
  const human = existing.filter((e) => HUMAN.has(e.status));
  const decided = new Set(human.map(keyOf));
  return [...human, ...fresh.filter((e) => !decided.has(keyOf(e)))];
}

/** Applies the user's decisions. Refuses a correction without a value, or evidence of another document. */
export function applyDecisions(
  evidence: readonly FieldEvidence[],
  decisions: readonly FieldDecision[],
  now: ISODateTime,
): FieldEvidence[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const updated = new Map<ID, FieldEvidence>();
  for (const decision of decisions) {
    const current = updated.get(decision.evidenceId) ?? byId.get(decision.evidenceId);
    if (!current) throw new Error(`Unknown field ${decision.evidenceId}`);
    if (decision.action === 'correct') {
      const value = decision.value?.trim();
      if (!value) throw new Error('A correction needs a value.');
      updated.set(current.id, { ...current, value, status: 'user_corrected', reviewedAt: now });
    } else if (decision.action === 'confirm') {
      updated.set(current.id, { ...current, status: 'user_confirmed', reviewedAt: now });
    } else {
      updated.set(current.id, { ...current, value: null, status: 'unknown', reviewedAt: now });
    }
  }
  return evidence.map((e) => updated.get(e.id) ?? e);
}

const REVIEWED: ReadonlySet<FieldStatus> = new Set(['user_confirmed', 'user_corrected']);

/** Every critical field of the line has been confirmed or corrected by the user. */
export function lineVerified(evidence: readonly FieldEvidence[], lineIndex: number): boolean {
  const mine = evidence.filter((e) => e.lineIndex === lineIndex);
  return mine.length > 0 && mine.every((e) => REVIEWED.has(e.status));
}

/** The lines as the parser read them. An unreadable strength is 0 here; its evidence says so. */
export function toExtractedLines(parsed: ParsedDocument): ExtractedLine[] {
  return parsed.lines.map((line, lineIndex) => {
    const warnings = [...line.warnings];
    const soft = softReferenceWarning(line);
    if (soft) warnings.push(soft);
    return {
      lineIndex,
      productName: line.productName,
      ingredients: line.ingredients
        .filter((i) => i.name)
        .map((i) => ({ name: i.name, strength: i.strength ?? 0, unit: (i.unit ?? 'mg') as DoseUnit })),
      form: line.form,
      dosesPerDay: line.dosesPerDay,
      instruction: line.instruction,
      warnings,
    };
  });
}

const DOSE_UNITS: readonly DoseUnit[] = ['mcg', 'mg', 'g', 'ml', 'IU'];

/** The lines with the user's corrections applied, so the line form shows what was decided. */
export function applyEvidence(lines: readonly ExtractedLine[], evidence: readonly FieldEvidence[]): ExtractedLine[] {
  return lines.map((line) => {
    const mine = evidence.filter((e) => e.lineIndex === line.lineIndex && e.value !== null);
    const value = (field: CriticalField, ingredientIndex: number | null = null) =>
      mine.find((e) => e.field === field && e.ingredientIndex === ingredientIndex && (e.status === 'user_corrected' || e.status === 'user_confirmed'))?.value ?? null;

    let productName = value('medicine_name') ?? line.productName;
    const ingredients = line.ingredients.map((ingredient, index) => {
      const strengthValue = value('strength', index);
      const unitValue = value('unit', index);
      const nameValue = value('ingredient', index);
      const strength = strengthValue !== null && Number.isFinite(Number(strengthValue)) ? Number(strengthValue) : ingredient.strength;
      const unit = unitValue !== null && (DOSE_UNITS as readonly string[]).includes(unitValue) ? (unitValue as DoseUnit) : ingredient.unit;
      // A corrected strength replaces the unclear text in the product name: 'Aspirin 7? mg' → 'Aspirin 75 mg'.
      const raw = evidence.find((e) => e.lineIndex === line.lineIndex && e.field === 'strength' && e.ingredientIndex === index)?.raw;
      if (strengthValue !== null && raw && productName.includes(raw)) productName = productName.replace(raw, `${strength} ${unit}`);
      return { name: nameValue ?? ingredient.name, strength, unit };
    });
    const frequency = value('frequency');
    return {
      ...line,
      productName,
      ingredients,
      dosesPerDay: frequency !== null && Number.isFinite(Number(frequency)) ? Number(frequency) : line.dosesPerDay,
      instruction: value('instruction') ?? line.instruction,
    };
  });
}
