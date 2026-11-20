// Reading v2: text PDF → every page; scanned PDF → OCR of up to MAX_OCR_PAGES pages;
// photo → OCR. The cloud reader is used only when on-device reading was not good enough
// AND the caller allows it; otherwise the read is refused with cloud_consent_required and
// nothing leaves the device.
import { ServiceError as V1ServiceError, type ExtractionCandidate as V1Candidate } from '../../../contract/legacy/types';
import { ServiceError } from '../../../contract/types';
import { lookupProduct } from '../../drugref/lookup';
import { extractInCloud } from '../../reading/cloud';
import { normalizeIngredientName } from '../../rules/normalize';
import type { OcrLineInfo } from '../rules/verify';
import { createPaddleEngineV2, createTesseractEngineV2, type OcrEngineV2, type OcrPage } from './ocr';
import { parsePages, recognisedSomething, type ParsedDocument, type ParsedLine } from './parse';
import { readPdfPages, renderPdfPage, type PdfPages } from './pdf';

export const MAX_OCR_PAGES = 4;
export const MIN_TEXT_LENGTH = 20;
export const MIN_CONFIDENCE = 0.6;

export interface ReadingDepsV2 {
  pdfPages(file: Blob): Promise<PdfPages>;
  renderPdfPage(file: Blob, page: number): Promise<Blob>;
  /** Engines in order of preference; the next one is tried when one fails. */
  engines(): Promise<OcrEngineV2[]>;
  /** One image to the cloud reader. Only called with consent. */
  cloud(image: Blob): Promise<V1Candidate>;
}

export function defaultReadingDepsV2(fetcher?: typeof fetch): ReadingDepsV2 {
  let engines: Promise<OcrEngineV2[]> | null = null;
  return {
    pdfPages: (file) => readPdfPages(file),
    renderPdfPage: (file, page) => renderPdfPage(file, page),
    // Tesseract.js first until the phone benchmark (step 10) has been run.
    engines: () => (engines ??= Promise.resolve([createTesseractEngineV2(), createPaddleEngineV2()])),
    cloud: async (image) => {
      try {
        return await extractInCloud(image, fetcher);
      } catch (error) {
        throw toV2Error(error);
      }
    },
  };
}

/** The cloud client is shared with v1 and throws v1 errors; the v2 services need v2 ones. */
export function toV2Error(error: unknown): unknown {
  if (!(error instanceof V1ServiceError)) return error;
  // A 503 from the server means cloud reading is not set up on this copy.
  const code = error.code === 'network' && /\(503\)/.test(error.message) ? 'not_configured' : error.code;
  return new ServiceError(code, error.message);
}

export interface ReadResult {
  engine: 'pdf_text' | 'on_device' | 'cloud';
  source: 'pdf_text' | 'ocr' | 'cloud';
  parsed: ParsedDocument;
  ocrLines: OcrLineInfo[];
  pageCount: number | null;
  pagesRead: number | null;
  confidence: number;
}

async function kindOf(file: Blob): Promise<'pdf' | 'image' | null> {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if ((head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50)) return 'image';
  return null;
}

async function recognize(image: Blob, engines: OcrEngineV2[]): Promise<OcrPage> {
  for (const engine of engines) {
    try {
      return await engine.recognize(image);
    } catch (error) {
      console.warn(`CareVault: on-device OCR (${engine.name}) failed`, error);
    }
  }
  // No engine could run (no network for the model, an old browser). The cloud reader can
  // still be offered, so this counts as an unreadable image, not a crash.
  return { text: '', confidence: 0, lines: [] };
}

const visibleLength = (text: string) => text.replace(/\s/g, '').length;

/** On-device reading was not good enough to use. */
export function needsCloud(parsed: ParsedDocument, confidence: number): boolean {
  if (visibleLength(parsed.text) < MIN_TEXT_LENGTH) return true;
  if (confidence < MIN_CONFIDENCE) return true;
  const namesMedicines = parsed.kind === 'prescription' || parsed.kind === 'other';
  return namesMedicines && !recognisedSomething(parsed.lines);
}

/** The cloud reader's answer, as parsed lines. Every value from it is checked by the user. */
export function parsedFromCloud(candidate: V1Candidate): ParsedDocument {
  const lines: ParsedLine[] = candidate.lines.map((line) => ({
    page: 1,
    sourceText: line.productName,
    productName: line.productName,
    ingredients: line.ingredients.map((i) => ({
      name: normalizeIngredientName(i.name),
      nameRaw: i.name,
      strength: i.strength,
      unit: i.unit,
      strengthRaw: `${i.strength} ${i.unit}`,
      unclear: false,
      fromReference: false,
    })),
    form: line.form,
    dosesPerDay: line.dosesPerDay,
    instruction: line.instruction,
    doseRaw: null,
    warnings: line.warnings,
    reference: lookupProduct(line.productName)?.entry ?? null,
  }));
  return {
    kind: candidate.documentType === 'prescription' || candidate.documentType === 'lab_report' || candidate.documentType === 'test' || candidate.documentType === 'discharge_summary' ? candidate.documentType : 'other',
    clinicalDate: candidate.documentDate,
    dateRaw: candidate.documentDate,
    dateUnclear: false,
    prescriberName: candidate.prescriberName,
    lines,
    text: candidate.rawText,
  };
}

export async function readFile(file: Blob, opts: { allowCloud: boolean }, deps: ReadingDepsV2): Promise<ReadResult> {
  const kind = await kindOf(file);
  if (kind === null || file.size === 0) throw new ServiceError('unsupported_file', 'Please choose a photo or a PDF.');

  let pageCount: number | null = 1;
  let pagesRead: number | null = 1;
  let parsed: ParsedDocument;
  let ocrLines: OcrLineInfo[] = [];
  let confidence = 1;
  let source: ReadResult['source'] = 'ocr';
  let firstImage: Blob | null = kind === 'image' ? file : null;

  if (kind === 'pdf') {
    const pdf = await deps.pdfPages(file);
    pageCount = pdf.pageCount;
    if (visibleLength(pdf.pages.join('')) >= MIN_TEXT_LENGTH) {
      source = 'pdf_text';
      pagesRead = pdf.pageCount;
      parsed = parsePages(pdf.pages.map((text, i) => ({ page: i + 1, text })));
    } else {
      // A scanned PDF: OCR the first pages and say how many were read.
      pagesRead = Math.min(pdf.pageCount, MAX_OCR_PAGES);
      const engines = await deps.engines();
      const pages: { page: number; text: string }[] = [];
      const confidences: number[] = [];
      for (let n = 1; n <= pagesRead; n += 1) {
        const image = await deps.renderPdfPage(file, n);
        if (n === 1) firstImage = image;
        const result = await recognize(image, engines);
        pages.push({ page: n, text: result.text });
        confidences.push(result.confidence);
        ocrLines.push(...result.lines.map((l) => ({ ...l, page: n })));
      }
      confidence = confidences.length ? Math.min(...confidences) : 0;
      parsed = parsePages(pages);
    }
  } else {
    const result = await recognize(file, await deps.engines());
    confidence = result.confidence;
    ocrLines = result.lines.map((l) => ({ ...l, page: 1 }));
    parsed = parsePages([{ page: 1, text: result.text }]);
  }

  if (source === 'pdf_text' || !needsCloud(parsed, confidence)) {
    return { engine: source === 'pdf_text' ? 'pdf_text' : 'on_device', source, parsed, ocrLines, pageCount, pagesRead, confidence };
  }
  if (!opts.allowCloud) {
    throw new ServiceError('cloud_consent_required', 'This could not be read well enough on the device.');
  }
  firstImage ??= await deps.renderPdfPage(file, 1);
  const fromCloud = parsedFromCloud(await deps.cloud(firstImage));
  return { engine: 'cloud', source: 'cloud', parsed: fromCloud, ocrLines: [], pageCount, pagesRead: 1, confidence: 1 };
}
