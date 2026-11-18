import { CloudUpload, Smartphone } from 'lucide-react';
import { cx } from '../lib/cx';

export interface CloudNoticeProps {
  /** Sentence shown while user data is leaving the device; null shows the on-device note. */
  message: string | null;
  /** Show "On this device" when nothing is leaving. Default false (render nothing). */
  showOnDevice?: boolean;
  className?: string;
}

/** Slim banner shown before and during any request that carries user data off the device. */
export function CloudNotice({ message, showOnDevice = false, className }: CloudNoticeProps) {
  if (!message && !showOnDevice) return null;
  const leaving = !!message;
  return (
    <div
      role="status"
      className={cx(
        'flex items-center gap-3 px-5 py-2.5 text-secondary font-medium md:px-10',
        leaving ? 'bg-blue-tint text-blue-ink' : 'bg-teal-tint text-teal-ink',
        className,
      )}
    >
      {leaving ? <CloudUpload aria-hidden className="size-5 shrink-0" /> : <Smartphone aria-hidden className="size-5 shrink-0" />}
      <span>{leaving ? message : 'On this device'}</span>
    </div>
  );
}
