import { CloudUpload } from 'lucide-react';
import { Button } from './Button';
import { CloudNotice } from './CloudNotice';

export interface CloudConsentPanelProps {
  /** 'photo' for a medicine pack, 'document' for an uploaded record. */
  what: 'photo' | 'document';
  sending: boolean;
  sendingMessage: string;
  onSend: () => void;
  onManual: () => void;
  manualLabel?: string;
}

/**
 * Asked when on-device reading is too poor (ServiceError 'cloud_consent_required').
 * Nothing leaves the device until "Send this photo/document" is pressed.
 */
export function CloudConsentPanel({ what, sending, sendingMessage, onSend, onManual, manualLabel = 'Enter by hand' }: CloudConsentPanelProps) {
  return (
    <section aria-labelledby="consent-title">
      <CloudUpload aria-hidden className="size-8 text-blue-ink" />
      <h2 id="consent-title" className="mt-3 font-sans text-card-sm font-semibold md:text-card">
        This {what} is hard to read on the device. Send it to the cloud reader?
      </h2>
      <p className="mt-3 text-ink-2">
        Only this {what} is sent, to read the printed text. Nothing else from this device goes with it. You will check every field
        before anything is saved.
      </p>
      {sending && <CloudNotice message={sendingMessage} className="mt-4 rounded-panel" />}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onSend} loading={sending}>
          Send this {what}
        </Button>
        <Button variant="secondary" onClick={onManual} disabled={sending}>
          {manualLabel}
        </Button>
      </div>
    </section>
  );
}
