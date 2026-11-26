// Share with a QR code (UI spec 4.11), bound to one snapshot: expiry 2, 8 or 24 hours, then the QR of
// the link just made, its expiry, Copy link, Revoke, and printing with that QR. The QR shown is the
// link chosen by id; the other links listed are those of the same snapshot only.
import { Copy, Link2, Printer, QrCode as QrIcon, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { PassportSnapshot } from '../../../contract/types';
import { Button } from '../../components/Button';
import { CloudNotice } from '../../components/CloudNotice';
import { Dialog } from '../../components/Dialog';
import { QrCode } from '../../components/QrCode';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toServiceError } from '../../hooks/toServiceError';
import { useCloudNotice, useServices, useToast } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatLocalDateTime } from '../../lib/format';
import {
  copyText, EXPIRY_HOURS, linksOfSnapshot, SHARE_EXPLANATION, SHARE_UPLOAD_MESSAGE, snapshotTitle, type ExpiryHours,
} from './shareLinks';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** The snapshot to share; null while it is being prepared. */
  snapshot: PassportSnapshot | null;
  /** Print this snapshot with the QR of this link. */
  onPrint: (linkId: string) => void;
}

export function ShareDialog({ open, onClose, snapshot, onPrint }: ShareDialogProps) {
  const services = useServices();
  const cloud = useCloudNotice();
  const toast = useToast();
  const [hours, setHours] = useState<ExpiryHours>('8');
  const [shownId, setShownId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkInputId = useId();
  const profileId = snapshot?.profileId ?? '';
  const links = useServiceQuery((s) => s.sharing.list(profileId), [profileId], { enabled: open && snapshot !== null });
  const revoke = useServiceAction((s, id: string) => s.sharing.revoke(id), { success: 'The link is turned off' });

  const all = links.data ?? [];
  const shown = shownId ? all.find((l) => l.id === shownId) ?? null : null;
  const others = snapshot ? linksOfSnapshot(all, snapshot.id).filter((l) => l.id !== shownId) : [];

  const create = async () => {
    if (!snapshot) return;
    setUploading(true);
    setError(null);
    try {
      const link = await cloud.run(SHARE_UPLOAD_MESSAGE, () => services.sharing.create(snapshot.id, Number(hours)));
      setShownId(link.id);
      links.reload();
    } catch (err) {
      setError(toServiceError(err).message);
    } finally {
      setUploading(false);
    }
  };

  const copy = async (url: string) => {
    if (await copyText(url)) {
      toast.show({ message: 'Link copied', tone: 'success' });
    } else {
      (document.getElementById(linkInputId) as HTMLInputElement | null)?.select();
      toast.show({ message: 'Select the link and copy it.', tone: 'info' });
    }
  };

  const close = () => {
    setShownId(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={uploading ? () => {} : close} title="Share with a QR code" description={SHARE_EXPLANATION} size="md">
      <div className="flex flex-col gap-6 pb-1">
        <p className="font-semibold text-ink">{snapshot ? snapshotTitle(snapshot) : 'Preparing the passport…'}</p>

        {!shown ? (
          <>
            <div>
              <p className="mb-2 font-semibold text-ink">The link expires after</p>
              <SegmentedControl
                label="The link expires after"
                value={hours}
                onChange={setHours}
                options={EXPIRY_HOURS.map((h) => ({ value: h, label: `${h} hours` }))}
              />
            </div>
            {uploading && <CloudNotice message={SHARE_UPLOAD_MESSAGE} className="rounded-panel" />}
            {error && (
              <p role="alert" className="rounded-panel bg-red-tint px-4 py-3 text-red-ink">
                The link could not be created. {error}
              </p>
            )}
            <Button icon={<Link2 aria-hidden className="size-5" />} onClick={() => void create()} loading={uploading} disabled={!snapshot} className="self-start">
              Create link
            </Button>
          </>
        ) : shown.revoked ? (
          <p role="status" className="rounded-panel bg-grey-tint px-4 py-3 text-ink-2">
            This link is turned off. Anyone who opens it sees that it was revoked.
          </p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div data-link-id={shown.id} className="shrink-0">
              <QrCode value={shown.url} label={`QR code for the link to ${snapshot ? snapshotTitle(snapshot) : 'the passport'}`} className="size-44 rounded-panel border border-line p-1" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Expires {formatLocalDateTime(shown.expiresAt)}</p>
              <label htmlFor={linkInputId} className="mt-3 block text-secondary text-ink-3">Link</label>
              <input
                id={linkInputId}
                readOnly
                value={shown.url}
                onFocus={(e) => e.target.select()}
                className="mt-1 min-h-11 w-full rounded-button border border-line bg-surface-muted px-3 text-secondary text-ink"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<Copy aria-hidden className="size-4" />} onClick={() => void copy(shown.url)}>Copy link</Button>
                <Button variant="secondary" size="sm" icon={<Printer aria-hidden className="size-4" />} onClick={() => onPrint(shown.id)}>Print with this QR code</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => void revoke.run(shown.id).then(() => links.reload())}
                  loading={revoke.pending}
                  className="!border-red-line !text-red-ink hover:!bg-red-tint"
                >
                  Revoke
                </Button>
              </div>
            </div>
          </div>
        )}

        {others.length > 0 && (
          <section aria-labelledby="snapshot-links-title" className="border-t border-line pt-5">
            <h3 id="snapshot-links-title" className="text-[17px]">Other active links to this passport</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {others.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-surface-muted px-4 py-2">
                  <span className="text-ink">Expires {formatLocalDateTime(l.expiresAt)}</span>
                  <Button size="sm" variant="quiet" icon={<QrIcon aria-hidden className="size-4" />} onClick={() => setShownId(l.id)}>
                    Show its QR code
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
