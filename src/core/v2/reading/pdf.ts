// PDF reading for v2 with pdf.js: the text of every page, the page count, and one page
// rendered as an image for OCR. A password-protected PDF is reported, never read.
import { ServiceError } from '../../../contract/types';
import { loadPdfJs, type PdfLoader } from '../../reading/pdfText';

export interface PdfPages {
  pageCount: number;
  /** The text layer of each page, one printed line per line. Empty for scanned pages. */
  pages: string[];
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Text items grouped into lines by their baseline, left to right. */
export function textItemsToLines(items: readonly TextItem[]): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => {
      row.sort((a, b) => a.transform[4] - b.transform[4]);
      let line = '';
      let end = 0;
      for (const item of row) {
        if (line && !line.endsWith(' ') && !item.str.startsWith(' ') && item.transform[4] - end > 1) line += ' ';
        line += item.str;
        end = item.transform[4] + item.width;
      }
      return line.replace(/\s+/g, ' ').trim();
    });
}

/** pdf.js rejects with an error named 'PasswordException' for a protected file. */
function isPasswordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'PasswordException';
}

const locked = () =>
  new ServiceError('locked_pdf', 'This PDF is password-protected. It is saved; fill in the details by hand.');

export async function readPdfPages(file: Blob, load: PdfLoader = loadPdfJs): Promise<PdfPages> {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(textItemsToLines(content.items as TextItem[]).join('\n'));
    }
    return { pageCount: doc.numPages, pages };
  } catch (error) {
    if (isPasswordError(error)) throw locked();
    throw error;
  } finally {
    await task.destroy();
  }
}

/** One page as a PNG, for OCR or the cloud reader. Needs a browser canvas. */
export async function renderPdfPage(file: Blob, pageNumber: number, load: PdfLoader = loadPdfJs): Promise<Blob> {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    // About 1600 px on the long side: enough for small print, small enough for a phone.
    const viewport = page.getViewport({ scale: Math.min(3, 1600 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The page could not be rendered.'))), 'image/png'),
    );
  } catch (error) {
    if (isPasswordError(error)) throw locked();
    throw error;
  } finally {
    await task.destroy();
  }
}
