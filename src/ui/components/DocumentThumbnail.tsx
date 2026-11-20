import { FileText, Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DocumentRecord } from '../../contract/legacy/types';
import { useServices } from '../hooks/useContexts';
import { canRenderPdf, openPdf, renderPdfPage } from './pdfPreview';

/**
 * First-page thumbnail: page 1 of a PDF rendered with pdf.js, or the image itself.
 * Loads only once the card scrolls near the viewport; falls back to an icon.
 */
export function DocumentThumbnail({ document: doc }: { document: Pick<DocumentRecord, 'id' | 'mimeType' | 'title'> }) {
  const services = useServices();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ready' | 'failed'>('idle');
  const isPdf = doc.mimeType === 'application/pdf';
  const isImage = doc.mimeType.startsWith('image/');
  const possible = isImage || (isPdf && canRenderPdf());

  useEffect(() => {
    const node = box.current;
    if (!node || !possible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [possible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const file = await services.documents.file(doc.id);
        if (cancelled) return;
        if (isImage && img.current) {
          objectUrl = URL.createObjectURL(file);
          img.current.src = objectUrl;
        } else if (isPdf && canvas.current) {
          const pdf = await openPdf(file);
          if (cancelled) return;
          await renderPdfPage(pdf, 1, canvas.current, box.current?.clientWidth || 320);
          void pdf.loadingTask.destroy();
        }
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, services, doc.id, isImage, isPdf]);

  return (
    <div ref={box} className="relative flex h-full w-full items-start justify-center overflow-hidden bg-surface-muted">
      {status !== 'ready' && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-center text-line-strong">
          {isImage ? <ImageIcon className="size-10" /> : <FileText className="size-10" />}
        </div>
      )}
      {isPdf && <canvas ref={canvas} aria-hidden className={status === 'ready' ? 'block bg-white' : 'hidden'} />}
      {isImage && <img ref={img} alt="" className={status === 'ready' ? 'h-full w-full object-cover' : 'hidden'} />}
    </div>
  );
}
