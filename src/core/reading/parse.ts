// Raw text -> ExtractionCandidate. Deterministic: regular expressions and the drug
// reference only. It reports what is printed and never fills a gap with a guess.
import type {
  DocumentType,
  DoseUnit,
  ExtractedLine,
  ExtractionCandidate,
  Ingredient,
  ISODate,
  MedicineForm,
} from '../../contract/legacy/types';
import { findProductsInText, isKnownIngredient, lookupProduct } from '../drugref/lookup';
import { normalizeIngredientName } from '../rules/normalize';

export const WARNING_NO_FREQUENCY = 'How often it is taken was not found.';
export const WARNING_NO_COMPOSITION = 'The composition was not read. Please enter the ingredients from the pack.';
export const WARNING_FROM_REFERENCE = (product: string) =>
  `The ingredients were not printed. They were filled in from the drug reference for ${product}. Please check.`;

// ---------- strengths ----------

const UNIT_WORDS: Record<string, DoseUnit> = {
  mcg: 'mcg', 'µg': 'mcg', 'μg': 'mcg', ug: 'mcg',
  mg: 'mg', g: 'g', gm: 'g',
  ml: 'ml',
  iu: 'IU', 'i.u': 'IU', 'i.u.': 'IU',
};

// A unit followed by '/' is a concentration or a lab value ('180 mg/dL'), not a strength.
const STRENGTH = /(\d+(?:\.\d+)?)\s?(mcg|µg|μg|ug|mg|gm|g|ml|i\.u\.?|iu)(?![a-z/])/gi;

interface Strength {
  value: number;
  unit: DoseUnit;
  start: number;
  end: number;
}

export function findStrengths(text: string): Strength[] {
  return [...text.matchAll(STRENGTH)].map((m) => ({
    value: Number(m[1]),
    unit: UNIT_WORDS[m[2].toLowerCase()],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

// ---------- ingredients ----------

const NAME_STOP = new Set([
  'contains', 'contain', 'containing', 'composition', 'each', 'tablet', 'tablets', 'capsule', 'capsules',
  'uncoated', 'coated', 'film', 'enteric', 'and', 'to', 'of', 'as', 'eq', 'equivalent', 'with', 'per',
  'tab', 'cap', 'syp', 'syr', 'inj', 'rx', 'the', 'hard', 'gelatin', 'sustained', 'release', 'is',
  'take', 'give', 'dose', 'dosage', 'net', 'content', 'contents', 'store', 'below', 'upto', 'about',
]);
const FORM_WORDS = new Set(['tablet', 'tablets', 'capsule', 'capsules', 'suspension', 'syrup']);
const PHARMACOPOEIA = /^(i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|ph\.?|eur\.?)$/i;

/** The words just before a strength, back to the nearest punctuation or filler word. */
function nameBefore(text: string): string {
  const segment = text.split(/[:;,+()]|\d+(?:\.\d+)?\s?(?:mcg|mg|gm|g|ml|iu)\b/i).pop() ?? '';
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const name: string[] = [];
  for (let i = words.length - 1; i >= 0 && name.length < 4; i -= 1) {
    const word = words[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '');
    if (!word || PHARMACOPOEIA.test(word)) {
      if (name.length === 0) continue;
      break;
    }
    const lower = word.toLowerCase().replace(/\.$/, '');
    // A stray letter between the name and the strength is OCR debris: 'Ibuprofen |.P. 400 mg'
    // reads as 'P.' once the bar is dropped.
    if (name.length === 0 && /^[a-z]$/.test(lower)) continue;
    // 'Paracetamol Tablets IP 650 mg': the form sits between the name and the strength.
    if (name.length === 0 && FORM_WORDS.has(lower)) continue;
    if (NAME_STOP.has(lower) || /^\d/.test(word)) break;
    name.unshift(word);
  }
  return name.join(' ');
}

/** Every 'name strength unit' in a piece of text: 'Paracetamol IP 650 mg' and so on. */
export function findIngredients(text: string): Ingredient[] {
  const found: Ingredient[] = [];
  let from = 0;
  for (const strength of findStrengths(text)) {
    const name = normalizeIngredientName(nameBefore(text.slice(from, strength.start)));
    from = strength.end;
    if (!name || !/[a-z]{3}/.test(name)) continue;
    if (!found.some((i) => i.name === name)) found.push({ name, strength: strength.value, unit: strength.unit });
  }
  return found;
}

// ---------- form and dose ----------

export function findForm(text: string): MedicineForm | null {
  if (/\b(tab|tabs|tablet|tablets)\b\.?/i.test(text)) return 'tablet';
  if (/\b(cap|caps|capsule|capsules)\b\.?/i.test(text)) return 'capsule';
  if (/\b(syp|syr|syrup|suspension|oral solution)\b\.?/i.test(text)) return 'syrup';
  return null;
}

const TIMES = ['morning', 'afternoon', 'night'];
const FREQUENCY_WORDS: [RegExp, number, string][] = [
  [/\b(once (a|per) day|once daily|od|o\.d\.?|qd)\b/i, 1, 'once a day'],
  [/\b(twice (a|per) day|twice daily|two times a day|bd|b\.d\.?|bid)\b/i, 2, 'twice a day'],
  [/\b(three times (a|per) day|thrice (a|per) day|thrice daily|tds|t\.d\.s\.?|tid)\b/i, 3, 'three times a day'],
  [/\b(four times (a|per) day|qid|q\.i\.d\.?|qds)\b/i, 4, 'four times a day'],
  [/\b(at bedtime|at night|hs|h\.s\.?)\b/i, 1, 'night'],
];
const MEAL_WORDS: [RegExp, string][] = [
  [/\bbefore breakfast\b/i, 'before breakfast'],
  [/\b(before (food|meals?)|a\.?c\.?)\b/i, 'before food'],
  [/\b(after (food|meals?)|p\.?c\.?)\b/i, 'after food'],
];

export interface Dose {
  dosesPerDay: number | null;
  /** Words for the instruction, without the form: 'morning', 'twice a day'. */
  when: string;
}

/** '1-0-1', 'BD', 'twice a day' and the like. Null per day when nothing is stated. */
export function findDose(text: string): Dose {
  const meal = MEAL_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  const withMeal = (when: string) => [when, meal].filter(Boolean).join(', ');

  const slots = text.match(/(?<![\d-])(\d(?:\.5)?|½)\s?-\s?(\d(?:\.5)?|½)\s?-\s?(\d(?:\.5)?|½)(?![\d-])/);
  if (slots) {
    const counts = slots.slice(1, 4).map((s) => (s === '½' ? 0.5 : Number(s)));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const taken = counts.map((n, i) => ({ n, time: TIMES[i] })).filter((slot) => slot.n > 0);
    let when = '';
    if (taken.length === 0) when = '';
    else if (taken.length === 1) when = taken[0].time;
    else if (taken.every((slot) => slot.n === taken[0].n)) when = taken.length === 2 ? 'twice a day' : 'three times a day';
    else when = taken.map((slot) => `${slot.n} ${slot.time}`).join(', ');
    return { dosesPerDay: total > 0 ? total : null, when: withMeal(when) };
  }

  const word = FREQUENCY_WORDS.find(([pattern]) => pattern.test(text));
  if (word) return { dosesPerDay: word[1], when: withMeal(word[2]) };
  return { dosesPerDay: null, when: withMeal('') };
}

function instructionFor(form: MedicineForm, dose: Dose, perDose: number | null): string {
  if (!dose.when) return '';
  // Mixed amounts ('2 morning, 1 night') already carry their own counts.
  if (/^\d/.test(dose.when)) return dose.when;
  const unit = form === 'other' || form === 'syrup' ? 'dose' : form;
  return `${perDose ?? 1} ${unit}, ${dose.when}`;
}

// ---------- header fields ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(year: number, month: number, day: number): ISODate | null {
  if (year < 100) year += 2000;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The first date in the text. Numeric dates are read day first (the Indian convention).
 * Manufacturing and expiry dates on a pack are not document dates and are skipped.
 */
export function findDate(text: string): ISODate | null {
  for (const line of text.split(/\r?\n/)) {
    if (/\b(mfg|mfd|manufactur|exp|expiry|use before|best before|batch|dob|date of birth|born)\b/i.test(line)) continue;
    let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) {
      const date = iso(Number(m[1]), Number(m[2]), Number(m[3]));
      if (date) return date;
    }
    m = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
    if (m) {
      const date = iso(Number(m[3]), Number(m[2]), Number(m[1]));
      if (date) return date;
    }
    m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})\b/);
    if (m) {
      const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
      const date = iso(Number(m[3]), month, Number(m[1]));
      if (date) return date;
    }
    m = line.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\b/);
    if (m) {
      const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      const date = iso(Number(m[3]), month, Number(m[2]));
      if (date) return date;
    }
  }
  return null;
}

/** 'Dr. Kavita Rao'. Stops at the end of the line and at qualifications. */
export function findPrescriber(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (/\b(ref(erred|\.)? by|referring)\b/i.test(line) && !/\bDr\b/.test(line)) continue;
    const m = line.match(/\bDr\.?\s+((?:[A-Z][A-Za-z'.]*\s?){1,4})/);
    if (!m) continue;
    const words: string[] = [];
    for (const word of m[1].trim().split(/\s+/)) {
      // Qualifications and labels printed after the name end it.
      if (/^(MBBS|MD|DM|MS|DNB|FRCP|MRCP|Date|Reg|Consultant|Patient|Age|Ref)\b/i.test(word) || words.length === 3) break;
      words.push(word);
    }
    const name = words.join(' ').replace(/[.,]+$/, '');
    if (name) return `Dr. ${name}`;
  }
  return null;
}

export function findDocumentType(text: string): DocumentType {
  const t = text.toLowerCase();
  if (/\bdischarge summary\b/.test(t)) return 'discharge_summary';
  const reportWords = /\b(lab(oratory)? report|test report|pathology|reference (range|interval)|specimen|sample collected|lipid profile|hba1c|haemoglobin|hemoglobin|blood (sugar|glucose)|cbc|thyroid profile|creatinine)\b/;
  const testWords = /\b(ecg|electrocardiogram|echocardiogra\w+|x-?ray|ultrasound|usg|ct scan|mri|radiology|impression)\b/;
  const rxWords = /(\brx\b|℞|\bprescription\b|\b\d\s?-\s?\d\s?-\s?\d\b|\b(tab|cap|syp)\.)/;
  if (rxWords.test(t)) return 'prescription';
  if (testWords.test(t) && !reportWords.test(t)) return 'test';
  if (reportWords.test(t)) return 'lab_report';
  if (testWords.test(t)) return 'test';
  return 'other';
}

// ---------- lines ----------

const KEEP_CASE: Record<string, string> = { mg: 'mg', mcg: 'mcg', ml: 'ml', g: 'g', gm: 'g', iu: 'IU', ip: 'IP', bp: 'BP', usp: 'USP' };

/** 'ZYLORIC 100' -> 'Zyloric 100'. Units and pharmacopoeia marks keep their usual case. */
const titleCase = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => KEEP_CASE[word.toLowerCase().replace(/\./g, '')] ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

/** One line per medicine on a prescription: a product or ingredient we know, or 'Tab.' and a strength. */
function prescriptionLines(text: string): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const form = findForm(line);
    const product = findProductsInText(line)[0];
    const strengths = findStrengths(line);
    const printed = findIngredients(line).filter((i) => isKnownIngredient(i.name));
    const prefixed = /^\s*(\d+[.)]\s*)?(tab|cap|syp|syr|inj)\b\.?/i.test(line);
    if (!product && printed.length === 0 && !(prefixed && strengths.length > 0)) continue;

    const dose = findDose(line);
    const warnings: string[] = [];
    let productName: string;
    let ingredients: Ingredient[];

    if (printed.length > 0) {
      ingredients = printed;
      productName = product?.entry.productName ?? titleCase(printed.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + '));
    } else if (product) {
      productName = product.entry.productName;
      ingredients = product.entry.ingredients.map((i) => ({ ...i }));
      warnings.push(WARNING_FROM_REFERENCE(product.entry.productName));
    } else {
      // 'Tab. Something 10 mg' with a name the reference does not know.
      const unknown = findIngredients(line);
      const rest = line.replace(/^\s*(\d+[.)]\s*)?(tab|cap|syp|syr|inj)\b\.?\s*/i, '');
      const name = rest.slice(0, findStrengths(rest)[0]?.end ?? rest.length).trim();
      productName = name || line;
      ingredients = unknown;
    }

    if (dose.dosesPerDay === null) warnings.push(WARNING_NO_FREQUENCY);
    const lineForm = form ?? product?.entry.form ?? 'tablet';
    lines.push({
      productName,
      ingredients,
      form: lineForm,
      dosesPerDay: dose.dosesPerDay,
      instruction: instructionFor(lineForm, dose, null),
      warnings,
    });
  }
  return lines;
}

/** A pack label describes one product: its name, and a composition line. */
function packLine(text: string): ExtractedLine[] {
  const product = findProductsInText(text)[0];
  const compositionAt = text.search(/\b(contains?|composition)\b/i);
  const composition = compositionAt >= 0 ? findIngredients(text.slice(compositionAt)) : [];
  const printed = composition.length > 0 ? composition : findIngredients(text).filter((i) => isKnownIngredient(i.name));
  if (!product && printed.length === 0) return [];

  const warnings: string[] = [];
  let ingredients = printed;
  if (printed.length === 0 && product) {
    ingredients = product.entry.ingredients.map((i) => ({ ...i }));
    warnings.push(WARNING_FROM_REFERENCE(product.entry.productName));
  }
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => /[A-Za-z]{3}/.test(l)) ?? '';
  const productName = product?.entry.productName ?? titleCase(firstLine).slice(0, 60);
  const dose = findDose(text);
  if (dose.dosesPerDay === null) warnings.push(WARNING_NO_FREQUENCY);
  const form = findForm(text) ?? product?.entry.form ?? 'other';
  return [
    {
      productName,
      ingredients,
      form,
      dosesPerDay: dose.dosesPerDay,
      instruction: instructionFor(form, dose, null),
      warnings,
    },
  ];
}

/** True when a product name from the reference, or a known ingredient, was recognised. */
export function recognisedSomething(lines: readonly ExtractedLine[]): boolean {
  return lines.some(
    (line) => lookupProduct(line.productName) !== null || line.ingredients.some((i) => isKnownIngredient(i.name)),
  );
}

/**
 * Undoes the commonest OCR confusion before parsing: a capital I or a lowercase l read as
 * a vertical bar ('|.P.' for 'I.P.'). A bar has no meaning on a pack or a prescription.
 */
export function cleanOcrText(text: string): string {
  return text.replace(/\|/g, 'I');
}

export function parseText(rawText: string): ExtractionCandidate {
  const text = cleanOcrText(rawText);
  const documentType = findDocumentType(text);
  let lines: ExtractedLine[] = [];
  if (documentType === 'prescription') lines = prescriptionLines(text);
  else if (documentType === 'other') lines = packLine(text);

  return {
    documentType,
    documentDate: findDate(text),
    prescriberName: findPrescriber(text),
    lines,
    engine: 'on_device',
    rawText,
    needsCloud: false,
  };
}
