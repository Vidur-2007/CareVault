// OCR engines for reading v2. Same engines as v1 (Tesseract.js first, PaddleOCR.js as
// fallback) but they return lines with word-level confidence and boxes, which the field
// evidence uses. Both are loaded on first use only.
import type { OcrLineInfo, OcrWordInfo } from '../rules/verify';

export interface OcrPage {
  text: string;
  /** 0 to 1. */
  confidence: number;
  lines: Omit<OcrLineInfo, 'page'>[];
}

export interface OcrEngineV2 {
  readonly name: 'tesseract' | 'paddle';
  recognize(image: Blob): Promise<OcrPage>;
  dispose(): Promise<void>;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

interface TesseractWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TesseractLine { text: string; confidence: number; words: TesseractWord[] }
interface TesseractBlock { paragraphs: { lines: TesseractLine[] }[] }

/** Tesseract.js 'blocks' output → lines with words. Confidence is 0-100 there, 0-1 here. */
export function linesFromTesseract(blocks: readonly TesseractBlock[] | null): OcrPage['lines'] {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        text: line.text.trim(),
        confidence: clamp(line.confidence / 100),
        words: line.words.map((w): OcrWordInfo => ({
          text: w.text,
          confidence: clamp(w.confidence / 100),
          box: { x: w.bbox.x0, y: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 },
        })),
      })),
    ),
  ).filter((line) => line.text);
}

export function createTesseractEngineV2(): OcrEngineV2 {
  type Worker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;
  let worker: Promise<Worker> | null = null;
  const start = () => (worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng')));
  return {
    name: 'tesseract',
    async recognize(image) {
      // Since Tesseract.js v6 only 'text' is returned unless other outputs are asked for.
      const { data } = await (await start()).recognize(image, {}, { text: true, blocks: true });
      return {
        text: data.text,
        confidence: clamp(data.confidence / 100),
        lines: linesFromTesseract(data.blocks as unknown as TesseractBlock[] | null),
      };
    },
    async dispose() {
      const current = worker;
      worker = null;
      if (current) await (await current).terminate();
    },
  };
}

interface PaddleItem { poly: number[][]; text: string; score: number }

/** PaddleOCR.js items (one per text line) → lines in reading order, top to bottom, left to right. */
export function linesFromPaddle(items: readonly PaddleItem[]): OcrPage['lines'] {
  const boxes = items
    .filter((item) => item.text.trim())
    .map((item) => {
      const xs = item.poly.map((p) => p[0]);
      const ys = item.poly.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const word: OcrWordInfo = {
        text: item.text.trim(),
        confidence: clamp(item.score),
        box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
      };
      return { word, middle: y + word.box.height / 2 };
    })
    .sort((a, b) => a.middle - b.middle);

  const rows: (typeof boxes)[] = [];
  for (const box of boxes) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].middle - box.middle) < Math.max(row[0].word.box.height, box.word.box.height) / 2) row.push(box);
    else rows.push([box]);
  }
  return rows.map((row) => {
    const words = row.sort((a, b) => a.word.box.x - b.word.box.x).map((b) => b.word);
    return { text: words.map((w) => w.text).join(' '), confidence: Math.min(...words.map((w) => w.confidence)), words };
  });
}

export function createPaddleEngineV2(): OcrEngineV2 {
  type Paddle = Awaited<ReturnType<(typeof import('@paddleocr/paddleocr-js'))['PaddleOCR']['create']>>;
  let ocr: Promise<Paddle> | null = null;
  const start = () =>
    (ocr ??= import('@paddleocr/paddleocr-js').then(({ PaddleOCR }) =>
      PaddleOCR.create({ lang: 'en', ocrVersion: 'PP-OCRv5', ortOptions: { backend: 'auto' } }),
    ));
  return {
    name: 'paddle',
    async recognize(image) {
      const [result] = await (await start()).predict(image);
      const lines = linesFromPaddle((result?.items ?? []) as PaddleItem[]);
      const scores = lines.flatMap((l) => l.words.map((w) => w.confidence));
      return {
        text: lines.map((l) => l.text).join('\n'),
        confidence: scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0,
        lines,
      };
    },
    async dispose() {
      const current = ocr;
      ocr = null;
      if (current) await (await current).dispose();
    },
  };
}
