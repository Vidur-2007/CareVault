import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './Button';
import { CloudNotice } from './CloudNotice';

export interface ReadingProgressProps {
  /** 'photo' or 'document', for the wording. */
  what: 'photo' | 'document';
  fileName?: string;
  onCancel?: () => void;
  onManual?: () => void;
}

/** Seconds since mount, ticking once a second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * The reading step. On-device reading is quick for text PDFs but the first photo downloads the
 * OCR engine and its model, which can take a while on a phone: the wording follows the wait,
 * and typing the details by hand is always one tap away.
 */
export function ReadingProgress({ what, fileName, onCancel, onManual }: ReadingProgressProps) {
  const seconds = useElapsedSeconds();
  const hint =
    seconds >= 25
      ? 'This is taking longer than usual. You can keep waiting, or type the details yourself.'
      : seconds >= 6
        ? `Still reading. The first ${what} downloads the reader once, which can take up to a minute on mobile data. The ${what} itself stays on this device.`
        : 'This usually takes a few seconds.';

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
        <LoaderCircle aria-hidden className="size-10 animate-spin text-teal" />
        <p className="text-card-sm font-semibold text-ink">Reading on this device</p>
        {fileName && <p className="break-all text-secondary text-ink-3">{fileName}</p>}
        <p className="max-w-md text-ink-2">{hint}</p>
      </div>
      <CloudNotice message={null} showOnDevice className="justify-center rounded-panel" />
      {(onManual || onCancel) && (
        <div className="flex flex-col gap-3 sm:flex-row">
          {onManual && (
            <Button variant="secondary" onClick={onManual}>
              Enter by hand instead
            </Button>
          )}
          {onCancel && (
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
