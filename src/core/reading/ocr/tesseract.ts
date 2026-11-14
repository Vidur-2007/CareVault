// Tesseract.js. The library and its English model are fetched on first use.
import type { OcrEngine, OcrResult } from './engine';

type Worker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

export function createTesseractEngine(): OcrEngine {
  let worker: Promise<Worker> | null = null;

  const start = () => {
    worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
    return worker;
  };

  return {
    name: 'tesseract',
    async recognize(image: Blob): Promise<OcrResult> {
      const { data } = await (await start()).recognize(image);
      return { text: data.text, confidence: Math.max(0, Math.min(1, data.confidence / 100)) };
    },
    async dispose() {
      const current = worker;
      worker = null;
      if (current) await (await current).terminate();
    },
  };
}
