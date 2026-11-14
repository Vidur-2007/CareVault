// reading.read(): PDF text or OCR on the device first, the cloud only with consent.
import { ServiceError, type ExtractionCandidate } from '../../contract/types';
import { crossCheck } from '../drugref/lookup';
import { extractInCloud } from './cloud';
import type { OcrEngine } from './ocr/engine';
import { parseText } from './parse';
import { extractPdfText, renderFirstPage } from './pdfText';
import { MIN_TEXT_LENGTH, needsCloud } from './quality';

export interface ReadingDeps {
  /** Engines in order of preference. The next one is tried when one fails. */
  engines: () => Promise<OcrEngine[]>;
  pdfText: (file: Blob) => Promise<string>;
  renderFirstPage: (file: Blob) => Promise<Blob>;
  cloud: (image: Blob) => Promise<ExtractionCandidate>;
}

export function defaultReadingDeps(): ReadingDeps {
  let engines: Promise<OcrEngine[]> | null = null;
  return {
    // The engine modules are imported on the first scan, not at start-up.
    // Tesseract.js first until the phone test in docs/progress-core.md picks an engine.
    engines: () =>
      (engines ??= Promise.all([import('./ocr/tesseract'), import('./ocr/paddle')]).then(([t, p]) => [
        t.createTesseractEngine(),
        p.createPaddleEngine(),
      ])),
    pdfText: (file) => extractPdfText(file),
    renderFirstPage: (file) => renderFirstPage(file),
    cloud: (image) => extractInCloud(image),
  };
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

async function recognize(image: Blob, engines: OcrEngine[]): Promise<{ text: string; confidence: number }> {
  let lastError: unknown = new Error('No OCR engine is available.');
  for (const engine of engines) {
    try {
      return await engine.recognize(image);
    } catch (error) {
      lastError = error;
    }
  }
  // Neither engine could run (no network for the model, old browser). The cloud reader
  // can still be offered, so this counts as an unreadable image, not a crash.
  console.warn('CareVault: on-device OCR failed', lastError);
  return { text: '', confidence: 0 };
}

/** Adds a warning to each line that disagrees with the drug reference. Changes no value. */
function withCrossCheck(candidate: ExtractionCandidate): ExtractionCandidate {
  return {
    ...candidate,
    lines: candidate.lines.map((line) => {
      const extra = crossCheck(line.productName, line.ingredients).filter((w) => !line.warnings.includes(w));
      return extra.length ? { ...line, warnings: [...line.warnings, ...extra] } : line;
    }),
  };
}

export async function readDocument(
  file: Blob,
  opts: { allowCloud: boolean },
  deps: ReadingDeps,
): Promise<ExtractionCandidate> {
  const kind = await kindOf(file);
  if (kind === null || file.size === 0) throw new ServiceError('unsupported_file', 'Please choose a photo or a PDF.');

  let text = '';
  let confidence = 1;
  let image: Blob | null = kind === 'image' ? file : null;

  if (kind === 'pdf') text = await deps.pdfText(file);
  if (text.replace(/\s/g, '').length < MIN_TEXT_LENGTH) {
    // A photo, or a scanned PDF with no text layer.
    image ??= await deps.renderFirstPage(file);
    ({ text, confidence } = await recognize(image, await deps.engines()));
  }

  const candidate = parseText(text);
  if (!needsCloud(candidate, confidence)) return withCrossCheck(candidate);

  if (!opts.allowCloud) {
    throw new ServiceError('cloud_consent_required', 'This could not be read well enough on the device.');
  }
  image ??= await deps.renderFirstPage(file);
  return withCrossCheck(await deps.cloud(image));
}
