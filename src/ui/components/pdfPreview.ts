// Lazy pdf.js loading: the library and its worker are fetched only when a PDF is first shown.
import type { PDFDocumentProxy } from 'pdfjs-dist';

let ready: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfJs() {
  ready ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return ready;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Renders one page into the canvas, fitted to `width` CSS pixels. Returns the page count. */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  width: number,
  zoom = 1,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = (width / base.width) * zoom;
  const ratio = globalThis.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
}
