// PaddleOCR.js (PP-OCRv5 on onnxruntime-web). The library and models are fetched on first use.
import type { OcrEngine, OcrResult } from './engine';

type Paddle = Awaited<ReturnType<(typeof import('@paddleocr/paddleocr-js'))['PaddleOCR']['create']>>;

interface Item {
  poly: number[][];
  text: string;
  score: number;
}

/** Boxes in reading order: top to bottom, and left to right within a row. */
export function linesFromItems(items: readonly Item[]): string {
  const boxes = items
    .filter((item) => item.text.trim())
    .map((item) => {
      const ys = item.poly.map((p) => p[1]);
      const xs = item.poly.map((p) => p[0]);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return { text: item.text.trim(), x: Math.min(...xs), middle: (top + bottom) / 2, height: bottom - top };
    })
    .sort((a, b) => a.middle - b.middle);

  const rows: (typeof boxes)[] = [];
  for (const box of boxes) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].middle - box.middle) < Math.max(row[0].height, box.height) / 2) row.push(box);
    else rows.push([box]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x).map((b) => b.text).join(' ')).join('\n');
}

export function createPaddleEngine(): OcrEngine {
  let ocr: Promise<Paddle> | null = null;

  const start = () => {
    ocr ??= import('@paddleocr/paddleocr-js').then(({ PaddleOCR }) =>
      PaddleOCR.create({ lang: 'en', ocrVersion: 'PP-OCRv5', ortOptions: { backend: 'auto' } }),
    );
    return ocr;
  };

  return {
    name: 'paddle',
    async recognize(image: Blob): Promise<OcrResult> {
      const [result] = await (await start()).predict(image);
      const items = (result?.items ?? []) as Item[];
      const scores = items.map((item) => item.score);
      const confidence = scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0;
      return { text: linesFromItems(items), confidence };
    },
    async dispose() {
      const current = ocr;
      ocr = null;
      if (current) await (await current).dispose();
    },
  };
}
