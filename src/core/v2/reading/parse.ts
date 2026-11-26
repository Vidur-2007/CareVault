// Raw text → structured lines, page by page. Deterministic: regular expressions and the drug
// reference only. It reports what is printed, keeps the literal text of every value it read,
// and never fills a gap with a guess: an unreadable strength stays unreadable (strength null)
// and is flagged by rules/verify.ts.
//
// Reuses the v1 helpers whose behaviour is unchanged (dates, doses, forms, doctor names).
import type { DoseUnit, MedicineForm } from '../../../contract/types';
import { findProductsInText, isKnownIngredient, type DrugEntry } from '../../drugref/lookup';
import { cleanOcrText, findDate, findDocumentType, findDose, findForm, findPrescriber } from '../../reading/parse';
import { normalizeIngredientName } from '../../rules/normalize';

export interface ParsedIngredient {
  /** Normalized: 'paracetamol'. Empty when the name could not be read. */
  name: string;
  /** As printed: 'Paracetamol IP'. */
  nameRaw: string;
  /** Null when missing or unclear. */
  strength: number | null;
  unit: DoseUnit | null;
  /** As printed: '650 mg', '7? mg', '75'. Null when nothing was printed. */
  strengthRaw: string | null;
  unclear: boolean;
  /** True when the composition was not printed and comes from the drug reference. */
  fromReference: boolean;
}

export interface ParsedLine {
  page: number;
  /** The text line the medicine was read from. */
  sourceText: string;
  productName: string;
  ingredients: ParsedIngredient[];
  form: MedicineForm;
  dosesPerDay: number | null;
  instruction: string;
  /** The dose text as printed ('1-0-1', 'BD'), or null. */
  doseRaw: string | null;
  warnings: string[];
  reference: DrugEntry | null;
}

export interface ParsedPage {
  page: number;
  text: string;
}

export interface ParsedDocument {
  kind: 'prescription' | 'lab_report' | 'test' | 'discharge_summary' | 'other';
  clinicalDate: string | null;
  /** The text of the line the date was read from. */
  dateRaw: string | null;
  /** True when something looks like a date but is not a real one. */
  dateUnclear: boolean;
  prescriberName: string | null;
  lines: ParsedLine[];
  text: string;
}

export const WARNING_FROM_REFERENCE = (product: string) =>
  `The ingredients were not printed. They were filled in from the drug reference for ${product}. Please check.`;
export const WARNING_NO_FREQUENCY = 'How often it is taken was not found.';

const UNIT_WORDS: Record<string, DoseUnit> = {
  mcg: 'mcg', 'µg': 'mcg', 'μg': 'mcg', ug: 'mcg', mg: 'mg', g: 'g', gm: 'g', ml: 'ml', iu: 'IU', 'i.u': 'IU', 'i.u.': 'IU',
};

// A strength: digits that may contain '?' where OCR could not read a digit, then a unit.
// A unit followed by '/' is a concentration or a lab value ('180 mg/dL'), not a strength.
const STRENGTH = /(?<![\w?])(\d[\d?]*(?:\.\d+)?|\?+\d[\d?]*|\?+)\s?(mcg|µg|μg|ug|mg|gm|g|ml|i\.u\.?|iu)(?![a-z/])/gi;
const PREFIX = /^\s*(?:\d+[.)]\s*)?(?:tab|cap|syp|syr|inj)\b\.?\s*/i;
const DOSE_START = /(?:\b|^)(?:\d(?:\.5)?|½)\s?-\s?(?:\d(?:\.5)?|½)\s?-\s?(?:\d(?:\.5)?|½)|\b(?:od|bd|tds|qid|hs|once|twice|thrice)\b/i;

interface RawStrength {
  start: number;
  end: number;
  raw: string;
  value: number | null;
  unit: DoseUnit;
  unclear: boolean;
}

export function findStrengths(text: string): RawStrength[] {
  return [...text.matchAll(STRENGTH)].map((m) => {
    const unclear = m[1].includes('?');
    return {
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0].trim(),
      value: unclear ? null : Number(m[1]),
      unit: UNIT_WORDS[m[2].toLowerCase()],
      unclear,
    };
  });
}

const NAME_STOP = new Set([
  'contains', 'contain', 'containing', 'composition', 'each', 'tablet', 'tablets', 'capsule', 'capsules', 'uncoated',
  'coated', 'film', 'enteric', 'and', 'to', 'of', 'as', 'eq', 'equivalent', 'with', 'per', 'tab', 'cap', 'syp', 'syr',
  'inj', 'rx', 'the', 'hard', 'gelatin', 'sustained', 'release', 'is', 'take', 'give', 'dose', 'dosage', 'net', 'content',
  'contents', 'store', 'below', 'upto', 'about',
]);
const FORM_WORDS = new Set(['tablet', 'tablets', 'capsule', 'capsules', 'suspension', 'syrup']);
const PHARMACOPOEIA = /^(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|ph\.?|eur\.?)$/i;

/** The words just before a strength, back to the nearest punctuation, filler word or line break. */
function nameBefore(text: string): string {
  // A name never runs across lines: on a pack, the brand line above is not part of it.
  const parts = text.split(/[:;,+()\n]|(?:\d[\d?]*(?:\.\d+)?|\?+)\s?(?:mcg|mg|gm|g|ml|iu)\b/i);
  const segment = parts[parts.length - 1];
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const name: string[] = [];
  for (let i = words.length - 1; i >= 0 && name.length < 4; i -= 1) {
    const word = words[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '');
    if (!word || PHARMACOPOEIA.test(word)) {
      if (name.length === 0) continue;
      break;
    }
    const lower = word.toLowerCase().replace(/\.$/, '');
    if (name.length === 0 && /^[a-z]$/.test(lower)) continue;
    if (name.length === 0 && FORM_WORDS.has(lower)) continue;
    if (NAME_STOP.has(lower) || /^\d/.test(word)) break;
    name.unshift(word);
  }
  return name.join(' ');
}

/** Every 'name strength unit' in a piece of text, keeping what was printed. */
export function findIngredients(text: string): ParsedIngredient[] {
  const found: ParsedIngredient[] = [];
  let from = 0;
  for (const s of findStrengths(text)) {
    const nameRaw = nameBefore(text.slice(from, s.start));
    from = s.end;
    const name = normalizeIngredientName(nameRaw);
    if (!name || !/[a-z]{3}/.test(name) || found.some((i) => i.name === name)) continue;
    found.push({ name, nameRaw, strength: s.value, unit: s.unit, strengthRaw: s.raw, unclear: s.unclear, fromReference: false });
  }
  return found;
}

const KEEP_CASE: Record<string, string> = { mg: 'mg', mcg: 'mcg', ml: 'ml', g: 'g', gm: 'g', iu: 'IU', ip: 'IP', bp: 'BP', usp: 'USP' };

/** 'ZYLORIC 100' → 'Zyloric 100'; units and pharmacopoeia marks keep their usual case. */
export function titleCase(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => KEEP_CASE[word.toLowerCase().replace(/\./g, '')] ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function instructionFor(form: MedicineForm, when: string): string {
  if (!when) return '';
  if (/^\d/.test(when)) return when;
  const unit = form === 'other' || form === 'syrup' ? 'dose' : form;
  return `1 ${unit}, ${when}`;
}

function doseRawOf(text: string): string | null {
  const m = text.match(DOSE_START);
  return m ? m[0].trim() : null;
}

function fromReference(entry: DrugEntry): ParsedIngredient[] {
  return entry.ingredients.map((i) => ({
    name: i.name, nameRaw: i.name, strength: i.strength, unit: i.unit, strengthRaw: null, unclear: false, fromReference: true,
  }));
}

/** One medicine per line of a prescription: a known product or ingredient, or 'Tab.' and a name. */
function prescriptionLine(page: number, raw: string): ParsedLine | null {
  const text = raw.trim();
  if (!text) return null;
  const product = findProductsInText(text)[0] ?? null;
  const printed = findIngredients(text).filter((i) => isKnownIngredient(i.name));
  const prefixed = PREFIX.test(text);
  if (!product && printed.length === 0 && !prefixed) return null;

  const rest = text.replace(PREFIX, '');
  const warnings: string[] = [];
  let ingredients: ParsedIngredient[];
  let productName: string;

  if (printed.length > 0) {
    ingredients = printed;
    // A printed ingredient was found next to a strength, so the line has at least one.
    productName = product?.entry.productName ?? titleCase(rest.slice(0, findStrengths(rest).at(-1)!.end));
  } else if (product) {
    ingredients = fromReference(product.entry);
    productName = product.entry.productName;
    warnings.push(WARNING_FROM_REFERENCE(product.entry.productName));
  } else {
    // 'Tab. Something …' with no known product: keep what is printed.
    const strengths = findStrengths(rest);
    const any = findIngredients(rest);
    if (any.length > 0) {
      ingredients = any;
    } else {
      // A name with no readable strength: 'Tab. Aspirin 0-1-0' or 'Tab. Aspirin 75'.
      const beforeDose = rest.split(DOSE_START)[0];
      const words = beforeDose.trim().split(/\s+/).filter((w) => w && !/^\d/.test(w));
      const nameRaw = words.slice(0, 3).join(' ');
      const bareNumber = beforeDose.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/)?.[1] ?? null;
      const name = normalizeIngredientName(nameRaw);
      ingredients = name && isKnownIngredient(name)
        ? [{ name, nameRaw, strength: null, unit: null, strengthRaw: bareNumber, unclear: bareNumber !== null, fromReference: false }]
        : [];
    }
    const end = strengths.at(-1)?.end ?? rest.split(DOSE_START)[0].trimEnd().length;
    productName = titleCase(rest.slice(0, end));
    // 'Tab.' followed only by a dose is not a medicine line.
    if (!productName) return null;
  }

  const dose = findDose(text);
  if (dose.dosesPerDay === null) warnings.push(WARNING_NO_FREQUENCY);
  // The contract has no injection form, so an injection is 'other'.
  const form = findForm(text) ?? product?.entry.form ?? (/^\s*(?:\d+[.)]\s*)?inj\b/i.test(text) ? 'other' : 'tablet');
  return {
    page,
    sourceText: text,
    productName,
    ingredients,
    form,
    dosesPerDay: dose.dosesPerDay,
    instruction: instructionFor(form, dose.when),
    doseRaw: doseRawOf(text),
    warnings,
    reference: product?.entry ?? null,
  };
}

/** A pack label describes one product: its name, and a composition line. */
function packLine(pages: ParsedPage[]): ParsedLine | null {
  const text = pages.map((p) => p.text).join('\n');
  const product = findProductsInText(text)[0] ?? null;
  const compositionAt = text.search(/\b(?:contains?|composition)\b/i);
  const composition = compositionAt >= 0 ? findIngredients(text.slice(compositionAt)) : [];
  const printed = composition.length > 0 ? composition : findIngredients(text).filter((i) => isKnownIngredient(i.name));
  if (!product && printed.length === 0) return null;

  const warnings: string[] = [];
  let ingredients = printed;
  if (printed.length === 0 && product) {
    ingredients = fromReference(product.entry);
    warnings.push(WARNING_FROM_REFERENCE(product.entry.productName));
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  // A product or a printed ingredient was found, so a line with letters exists, and the
  // product's own line exists; each of these lines is on one of the pages.
  const firstLine = lines.find((l) => /[A-Za-z]{3}/.test(l))!;
  const sourceText = product ? lines.find((l) => findProductsInText(l).length > 0)! : firstLine;
  const page = pages.find((p) => p.text.includes(sourceText))!.page;
  const dose = findDose(text);
  if (dose.dosesPerDay === null) warnings.push(WARNING_NO_FREQUENCY);
  const form = findForm(text) ?? product?.entry.form ?? 'other';
  return {
    page,
    sourceText,
    productName: product?.entry.productName ?? titleCase(firstLine).slice(0, 60),
    ingredients,
    form,
    dosesPerDay: dose.dosesPerDay,
    instruction: instructionFor(form, dose.when),
    doseRaw: doseRawOf(text),
    warnings,
    reference: product?.entry ?? null,
  };
}

const DATE_LIKE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;
const NOT_A_DOCUMENT_DATE = /\b(?:mfg|mfd|manufactur|exp|expiry|use before|best before|batch|dob|date of birth|born)\b/i;

function dateFacts(text: string): { iso: string | null; raw: string | null; unclear: boolean } {
  const iso = findDate(text);
  const candidates = text.split(/\r?\n/).filter((l) => !NOT_A_DOCUMENT_DATE.test(l));
  if (iso) {
    // findDate found it on one of these lines.
    const raw = candidates.find((l) => findDate(l) === iso)!.trim();
    return { iso, raw, unclear: false };
  }
  const odd = candidates.find((l) => DATE_LIKE.test(l));
  return { iso: null, raw: odd ? odd.match(DATE_LIKE)![0] : null, unclear: odd !== undefined };
}

export function parsePages(pages: ParsedPage[]): ParsedDocument {
  const cleaned = pages.map((p) => ({ page: p.page, text: cleanOcrText(p.text) }));
  const text = cleaned.map((p) => p.text).join('\n');
  const kind = findDocumentType(text);
  let lines: ParsedLine[] = [];
  if (kind === 'prescription') {
    lines = cleaned.flatMap((p) => p.text.split(/\r?\n/).map((l) => prescriptionLine(p.page, l)).filter((l): l is ParsedLine => l !== null));
  } else if (kind === 'other') {
    const line = packLine(cleaned);
    lines = line ? [line] : [];
  }
  const date = dateFacts(text);
  return {
    kind,
    clinicalDate: date.iso,
    dateRaw: date.raw,
    dateUnclear: date.unclear,
    prescriberName: findPrescriber(text),
    lines,
    text,
  };
}

/** True when a product or an ingredient from the drug reference was recognised. */
export function recognisedSomething(lines: readonly ParsedLine[]): boolean {
  return lines.some((line) => line.reference !== null || line.ingredients.some((i) => i.name && isKnownIngredient(i.name)));
}
