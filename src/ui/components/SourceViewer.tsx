import { FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { openPdf, renderPdfPage } from './pdfPreview';
import { Skeleton } from './Skeleton';

export interface SourceViewerProps {
  /** The original photo or PDF. Null while it is loading. */
  file: Blob | null;
  /** Describes the source for screen readers, e.g. 'Photo of the medicine pack'. */
  label: string;
  /** The extracted fields shown beside the source (below it on phones). */
  children?: ReactNode;
  className?: string;
}

/** Original image or PDF page 1 beside the extracted fields. The original is always kept and shown. */
export function SourceViewer({ file, label, children, className }: SourceViewerProps) {
  return (
    <div className={cx('grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-8', className)}>
      <figure className="min-w-0">
        <div className="max-h-[55dvh] overflow-auto rounded-panel border border-line bg-surface-muted md:max-h-none md:overflow-hidden">
          {file === null ? (
            <div role="status" aria-label="Loading the original">
              <Skeleton className="aspect-[3/4] w-full rounded-none" />
            </div>
          ) : file.type === 'application/pdf' ? (
            <PdfFirstPage file={file} label={label} />
          ) : (
            <ImagePreview file={file} label={label} />
          )}
        </div>
        <figcaption className="mt-2 text-secondary text-ink-3">Original, as it was added</figcaption>
      </figure>
      {children && <div className="min-w-0">{children}</div>}
    </div>
  );
}

function ImagePreview({ file, label }: { file: Blob; label: string }) {
  const img = useRef<HTMLImageElement>(null);
  // The object URL is created and revoked together, so it never outlives the image.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    if (img.current) img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <img ref={img} alt={label} className="max-h-[70dvh] w-full object-contain" />;
}

function PdfFirstPage({ file, label }: { file: Blob; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdf = await openPdf(file);
        if (cancelled || !canvas.current) return;
        await renderPdfPage(pdf, 1, canvas.current, box.current?.clientWidth || 480);
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div ref={box} className="relative min-h-48">
      {status === 'loading' && (
        <div role="status" aria-label="Loading the PDF">
          <Skeleton className="aspect-[3/4] w-full rounded-none" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 p-8 text-center text-ink-3">
          <FileWarning aria-hidden className="size-8" />
          This PDF could not be shown here.
        </div>
      )}
      <canvas ref={canvas} role="img" aria-label={label} className={cx('mx-auto block bg-white', status !== 'ready' && 'hidden')} />
    </div>
  );
}
