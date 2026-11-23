// Step 1 of "Add a record" (UI spec 4.4): take a photo, choose a photo or PDF, or import from Gmail.
import { Camera, FileUp, Mail } from 'lucide-react';
import { useRef } from 'react';
import type { DocumentRecord } from '../../../../contract/types';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';

export interface CaptureStepProps {
  onFile: (file: File, source: DocumentRecord['source']) => void;
  onGmail: () => void;
  /** Set when retaking the photo of an earlier record. */
  retakeTitle?: string | null;
}

export function CaptureStep({ onFile, onGmail, retakeTitle }: CaptureStepProps) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-6">
      {retakeTitle && (
        <Card tone="muted">
          <h2 className="font-sans text-card-sm font-semibold">Retake the photo of {retakeTitle}</h2>
          <p className="mt-2 text-ink-2">
            The checks you already made are kept and applied to the new photo. The earlier photo stays in Records until you remove it.
          </p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Button cta icon={<Camera aria-hidden className="size-5" />} onClick={() => camera.current?.click()}>
          Take a photo
        </Button>
        <Button variant="secondary" cta className="!shadow-none" icon={<FileUp aria-hidden className="size-5" />} onClick={() => picker.current?.click()}>
          Choose a photo or PDF
        </Button>
        {!retakeTitle && (
          <Button variant="secondary" cta className="!shadow-none" icon={<Mail aria-hidden className="size-5" />} onClick={onGmail}>
            Import from Gmail
          </Button>
        )}
      </div>
      {/* Hidden native inputs, labelled for assistive technology and tests. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file, 'camera');
        }}
      />
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        aria-label="Choose a photo or PDF"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file, 'upload');
        }}
      />
      <Card as="section" aria-labelledby="tips-title">
        <h2 id="tips-title" className="font-sans text-card-sm font-semibold">For a clear photo</h2>
        <ul className="mt-3 list-disc pl-5 text-ink-2">
          <li>Lay the page or pack on a flat surface.</li>
          <li>Use good light, without shadows or glare.</li>
          <li>Fit the whole page in the frame.</li>
        </ul>
        <p className="mt-3 text-secondary text-ink-3">The original is saved on this device first. Reading it never changes the medicines list.</p>
      </Card>
    </div>
  );
}
