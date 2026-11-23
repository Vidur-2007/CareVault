// Document preview (UI spec 4.5): PDF pages rendered with pdf.js, or the image, with page
// navigation and zoom. Only the zoomed content scrolls sideways.
import { ChevronLeft, ChevronRight, Download, FileWarning, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Skeleton } from '../../components/Skeleton';
import { canRenderPdf, openPdf, renderPdfPage } from '../../components/pdfPreview';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 items-center justify-center rounded-button border border-line bg-surface text-ink-2 hover:bg-surface-muted disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export interface DocumentPreviewProps {
  file: Blob | null;
  title: string;
  /** Shown when the file cannot be loaded. */
  error?: string | null;
}

/** Remount per file (key={documentId}) so page, zoom and loading state start fresh. */
export function DocumentPreview({ file, title, error }: DocumentPreviewProps) {
  const [zoomIndex, setZoomIndex] = useState(2);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const zoom = ZOOMS[zoomIndex];
  const isPdf = file?.type === 'application/pdf';
  const unsupported = isPdf && !canRenderPdf();
  const download = useRef<HTMLAnchorElement>(null);
  const shown = unsupported ? 'failed' : status;

  // A download link, so the original is always reachable even when it cannot be previewed.
  useEffect(() => {
    if (!file || !download.current || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    download.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Open the PDF once per file.
  useEffect(() => {
    if (!file || !isPdf || unsupported) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    openPdf(file)
      .then((doc) => {
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }
        opened = doc;
        setPdf(doc);
        setPages(doc.numPages);
        setPage(1);
      })
      .catch(() => !cancelled && setStatus('failed'));
    return () => {
      cancelled = true;
      if (opened) void opened.loadingTask.destroy();
    };
  }, [file, isPdf, unsupported]);

  // Render the current page whenever page or zoom changes.
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    const abort = new AbortController();
    const width = Math.max(240, (viewport.current?.clientWidth ?? 600) - 32);
    renderPdfPage(pdf, page, canvas.current, width, zoom, abort.signal)
      .then(() => !abort.signal.aborted && setStatus('ready'))
      .catch(() => !abort.signal.aborted && setStatus('failed'));
    // A newer page, zoom or document cancels this render, so the canvas is free for the next one.
    return () => abort.abort();
  }, [pdf, page, zoom]);

  // Images: the object URL lives exactly as long as the image.
  useEffect(() => {
    if (!file || isPdf || !img.current || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-panel border border-line bg-surface-muted p-10 text-center text-ink-3">
        <FileWarning aria-hidden className="size-8" />
        {error}
      </div>
    );
  }

  return (
    <figure className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2">
        {isPdf ? (
          <div className="flex items-center gap-2">
            <ToolButton label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || shown !== 'ready'}>
              <ChevronLeft aria-hidden className="size-5" />
            </ToolButton>
            <span aria-live="polite" className="min-w-24 text-center text-secondary text-ink-2">
              Page {page} of {pages}
            </span>
            <ToolButton label="Next page" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || shown !== 'ready'}>
              <ChevronRight aria-hidden className="size-5" />
            </ToolButton>
          </div>
        ) : (
          <span className="text-secondary text-ink-3">Photo</span>
        )}
        <div className="flex items-center gap-2">
          <ToolButton label="Zoom out" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0}>
            <ZoomOut aria-hidden className="size-5" />
          </ToolButton>
          <span aria-live="polite" className="w-12 text-center text-secondary text-ink-2">
            {Math.round(zoom * 100)}%
          </span>
          <ToolButton label="Zoom in" onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIndex === ZOOMS.length - 1}>
            <ZoomIn aria-hidden className="size-5" />
          </ToolButton>
          <ToolButton label="Fit to width" onClick={() => setZoomIndex(2)} disabled={zoomIndex === 2}>
            <Maximize2 aria-hidden className="size-5" />
          </ToolButton>
          {file && (
            <a
              ref={download}
              href="#download"
              download={title}
              aria-label="Download the original"
              title="Download the original"
              className="flex size-11 items-center justify-center rounded-button border border-line bg-surface text-ink-2 hover:bg-surface-muted"
            >
              <Download aria-hidden className="size-5" />
            </a>
          )}
        </div>
      </div>

      {/* Focusable so the zoomed page can be scrolled with the keyboard. */}
      <div ref={viewport} tabIndex={0} role="region" aria-label={`${title}, preview`} className="max-h-[75dvh] min-h-64 overflow-auto bg-grey-tint p-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/40">
        {!file ? (
          <div role="status" aria-label="Loading the document">
            <Skeleton className="mx-auto aspect-[3/4] w-full max-w-xl" />
          </div>
        ) : isPdf ? (
          <>
            {shown === 'loading' && (
              <div role="status" aria-label="Loading the PDF">
                <Skeleton className="mx-auto aspect-[3/4] w-full max-w-xl" />
              </div>
            )}
            {shown === 'failed' && (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-ink-3">
                <FileWarning aria-hidden className="size-8" />
                This PDF cannot be shown here. Use the download button to open the original.
              </div>
            )}
            <canvas ref={canvas} role="img" aria-label={`${title}, page ${page}`} className={shown === 'ready' ? 'mx-auto block bg-white shadow-card' : 'hidden'} />
          </>
        ) : (
          <img ref={img} alt={title} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block" />
        )}
      </div>
      <figcaption className="sr-only">{title}</figcaption>
    </figure>
  );
}
