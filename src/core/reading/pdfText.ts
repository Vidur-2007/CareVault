// PDF reading with pdf.js: the text layer when there is one, otherwise page 1 as an image.
type PdfJs = typeof import('pdfjs-dist');

export type PdfLoader = () => Promise<PdfJs>;

/** The browser build with its worker. Loaded only when the first PDF is read. */
export const loadPdfJs: PdfLoader = async () => {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
};

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Text items grouped into lines by their baseline, left to right. */
function toLines(items: TextItem[]): string[] {
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
        // A visible gap between two runs is a space, even if the PDF stores none.
        if (line && !line.endsWith(' ') && !item.str.startsWith(' ') && item.transform[4] - end > 1) line += ' ';
        line += item.str;
        end = item.transform[4] + item.width;
      }
      return line.replace(/\s+/g, ' ').trim();
    });
}

/** The text of every page, one printed line per line. Empty for a scanned PDF. */
export async function extractPdfText(file: Blob, load: PdfLoader = loadPdfJs): Promise<string> {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(toLines(content.items as TextItem[]).join('\n'));
    }
    return pages.join('\n').trim();
  } finally {
    await task.destroy();
  }
}

/** Page 1 as a PNG, for OCR or the cloud reader. Needs a browser canvas. */
export async function renderFirstPage(file: Blob, load: PdfLoader = loadPdfJs): Promise<Blob> {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
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
  } finally {
    await task.destroy();
  }
}
