// Client for POST /api/extract. Called only after the caregiver has agreed to send this
// one image. The answer is checked field by field before any of it is used.
import { z } from 'zod';
import {
  ServiceError,
  type DocumentType,
  type ExtractedLine,
  type ExtractionCandidate,
  type Ingredient,
  type MedicineForm,
} from '../../contract/legacy/types';
import { normalizeIngredientName } from '../rules/normalize';

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const DOCUMENT_TYPES: readonly DocumentType[] = ['prescription', 'lab_report', 'test', 'discharge_summary', 'other'];
const FORMS: readonly MedicineForm[] = ['tablet', 'capsule', 'syrup', 'other'];

const ingredientSchema = z.object({
  name: z.string().trim().min(1),
  strength: z.number().positive().finite(),
  unit: z.enum(['mcg', 'mg', 'g', 'ml', 'IU']),
});

const responseSchema = z.object({
  documentType: z.unknown().optional(),
  documentDate: z.unknown().optional(),
  prescriberName: z.unknown().optional(),
  rawText: z.unknown().optional(),
  lines: z.array(z.unknown()).optional(),
});

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const WARNING_DROPPED = 'Part of what the cloud reader returned could not be used and was left out. Please check every field.';

/** One line, keeping the fields that are valid and warning about the ones that are not. */
function cleanLine(value: unknown): ExtractedLine | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const productName = typeof raw.productName === 'string' ? raw.productName.trim() : '';
  if (!productName) return null;

  const warnings: string[] = Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === 'string') : [];
  let dropped = false;

  const ingredients: Ingredient[] = [];
  for (const item of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    const parsed = ingredientSchema.safeParse(item);
    if (parsed.success) ingredients.push({ ...parsed.data, name: normalizeIngredientName(parsed.data.name) });
    else dropped = true;
  }

  let form: MedicineForm = 'other';
  if (FORMS.includes(raw.form as MedicineForm)) form = raw.form as MedicineForm;
  else if (raw.form != null) dropped = true;

  let dosesPerDay: number | null = null;
  if (typeof raw.dosesPerDay === 'number' && Number.isFinite(raw.dosesPerDay) && raw.dosesPerDay > 0) dosesPerDay = raw.dosesPerDay;
  else if (raw.dosesPerDay != null) dropped = true;

  if (dropped) warnings.push(WARNING_DROPPED);
  return {
    productName,
    ingredients,
    form,
    dosesPerDay,
    instruction: typeof raw.instruction === 'string' ? raw.instruction.trim() : '',
    warnings,
  };
}

/** Turns the server's answer into a candidate. Anything invalid is dropped and reported. */
export function candidateFromCloud(body: unknown): ExtractionCandidate {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError('unknown', 'The cloud reader returned something unreadable.');
  const data = parsed.data;

  const lines: ExtractedLine[] = [];
  let droppedLines = 0;
  for (const value of data.lines ?? []) {
    const line = cleanLine(value);
    if (line) lines.push(line);
    else droppedLines += 1;
  }
  if (droppedLines > 0 && lines.length > 0 && !lines[0].warnings.includes(WARNING_DROPPED)) {
    lines[0].warnings.push(WARNING_DROPPED);
  }

  const date = typeof data.documentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.documentDate) ? data.documentDate : null;
  return {
    documentType: DOCUMENT_TYPES.includes(data.documentType as DocumentType) ? (data.documentType as DocumentType) : 'other',
    documentDate: date !== null && !Number.isNaN(Date.parse(date)) ? date : null,
    prescriberName: typeof data.prescriberName === 'string' && data.prescriberName.trim() ? data.prescriberName.trim() : null,
    lines,
    engine: 'cloud',
    rawText: typeof data.rawText === 'string' ? data.rawText : '',
    needsCloud: false,
  };
}

/** Sends one image to the server's cloud reader, with the page of the document it shows when known. */
export async function extractInCloud(image: Blob, fetcher: typeof fetch = fetch, page?: number): Promise<ExtractionCandidate> {
  if (image.size > MAX_IMAGE_BYTES) {
    throw new ServiceError('unsupported_file', 'This photo is too large for the cloud reader (over 6 MB).');
  }
  let response: Response;
  try {
    response = await fetcher('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageBase64: await toBase64(image), mimeType: image.type || 'image/jpeg', ...(page === undefined ? {} : { page }) }),
    });
  } catch {
    throw new ServiceError('network', 'The cloud reader could not be reached. Check the connection and try again.');
  }
  if (!response.ok) {
    throw new ServiceError('network', `The cloud reader did not answer (${response.status}). Please try again.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ServiceError('unknown', 'The cloud reader returned something unreadable.');
  }
  return candidateFromCloud(body);
}
