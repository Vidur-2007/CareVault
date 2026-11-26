// Lazy pdf.js loading: the library and its worker are fetched only when a PDF is first shown.
//
// Worker setup (pdfjs-dist 6): GlobalWorkerOptions.workerSrc must point at the worker file of the
// exact same version. Under Vite the `?url` import emits build/pdf.worker.min.mjs as an asset and
// returns its URL. The optional renderer worker (GlobalWorkerOptions.rendererSrc) is not set, so
// pages render on the main thread, which is fine for thumbnails and single-page previews.
import type { PDFDocumentProxy } from 'pdfjs-dist';

let ready: Promise<typeof import('pdfjs-dist')> | null = null;

/** pdf.js needs DOMMatrix and a 2D canvas; jsdom and very old browsers have neither. */
export function canRenderPdf(): boolean {
  return typeof window !== 'undefined' && typeof window.DOMMatrix === 'function';
}

function loadPdfJs() {
  ready ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return ready;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  if (!canRenderPdf()) throw new Error('PDF preview is not available in this browser.');
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Renders one page into the canvas, fitted to `width` CSS pixels times `zoom`. Aborting `signal`
 * cancels the render, so a new render can use the same canvas (pdf.js allows one at a time).
 */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  width: number,
  zoom = 1,
  signal?: AbortSignal,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  if (signal?.aborted) return;
  const base = page.getViewport({ scale: 1 });
  const scale = (width / base.width) * zoom;
  const ratio = globalThis.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  const task = page.render({ canvas, viewport });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
