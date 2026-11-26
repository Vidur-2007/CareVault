import { CloudUpload } from 'lucide-react';
import { Button } from './Button';
import { CloudNotice } from './CloudNotice';

export interface CloudConsentPanelProps {
  sending: boolean;
  sendingMessage: string;
  onSend: () => void;
  onManual: () => void;
  /** Offered for photos: take a clearer one instead. */
  onRetake?: () => void;
}

/**
 * Asked when on-device reading is too poor (UI spec 4.4 step 3). Consent is per document: nothing
 * leaves the device until "Send this page" is pressed.
 */
export function CloudConsentPanel({ sending, sendingMessage, onSend, onManual, onRetake }: CloudConsentPanelProps) {
  return (
    <section aria-labelledby="consent-title">
      <CloudUpload aria-hidden className="size-8 text-blue-ink" />
      <h2 id="consent-title" className="mt-3 font-sans text-card-sm font-semibold md:text-card">
        This page is hard to read on the device. Send this one page to the cloud reader?
      </h2>
      <p className="mt-3 text-ink-2">
        Only this page is sent, to read the printed text. Nothing else from this device goes with it. Every value it reads is
        marked for you to check.
      </p>
      {sending && <CloudNotice message={sendingMessage} className="mt-4 rounded-panel" />}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button onClick={onSend} loading={sending}>
          Send this page
        </Button>
        {onRetake && (
          <Button variant="secondary" onClick={onRetake} disabled={sending}>
            Retake the photo
          </Button>
        )}
        <Button variant="secondary" onClick={onManual} disabled={sending}>
          Enter by hand
        </Button>
      </div>
    </section>
  );
}
