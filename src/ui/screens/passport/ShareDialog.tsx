// Share the passport with a QR link (UI spec 7.9): expiry, create, QR, copy, revoke, active links.
import { Copy, Link2, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { Passport, ShareLink } from '../../../contract/legacy/types';
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
import { isActive } from './shareLinks';

/** Exact wording required by UI spec 7.9. */
export const SHARE_EXPLANATION =
  'The passport is encrypted on this phone. The link holds the key; anyone with the link can read it until it expires.';
export const SHARE_UPLOAD_MESSAGE = 'Uploading the encrypted passport';

type Hours = '2' | '8' | '24';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareDialog({ open, onClose, passport }: { open: boolean; onClose: () => void; passport: Passport | null }) {
  const services = useServices();
  const cloud = useCloudNotice();
  const toast = useToast();
  const [hours, setHours] = useState<Hours>('8');
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkInputId = useId();
  const links = useServiceQuery((s) => s.sharing.list(), [], { enabled: open });
  const revoke = useServiceAction((s, id: string) => s.sharing.revoke(id), { success: 'The link is turned off' });

  const create = async () => {
    if (!passport) return;
    setUploading(true);
    setError(null);
    try {
      const link = await cloud.run(SHARE_UPLOAD_MESSAGE, () => services.sharing.create(passport, Number(hours)));
      setCreated(link);
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
      const input = document.getElementById(linkInputId) as HTMLInputElement | null;
      input?.select();
      toast.show({ message: 'Select the link and copy it.', tone: 'info' });
    }
  };

  const close = () => {
    setCreated(null);
    setError(null);
    onClose();
  };

  const current = created && (links.data?.find((l) => l.id === created.id) ?? created);
  const others = (links.data ?? []).filter((l) => isActive(l) && l.id !== current?.id);

  return (
    <Dialog open={open} onClose={uploading ? () => {} : close} title="Share with a QR code" description={SHARE_EXPLANATION} size="md">
      <div className="flex flex-col gap-6 pb-1">
        {!current ? (
          <>
            <div>
              <p className="mb-2 font-semibold text-ink">The link expires after</p>
              <SegmentedControl
                label="The link expires after"
                value={hours}
                onChange={setHours}
                options={[
                  { value: '2', label: '2 hours' },
                  { value: '8', label: '8 hours' },
                  { value: '24', label: '24 hours' },
                ]}
              />
            </div>
            {uploading && <CloudNotice message={SHARE_UPLOAD_MESSAGE} className="rounded-panel" />}
            {error && (
              <p role="alert" className="rounded-panel bg-red-tint px-4 py-3 text-red-ink">
                The link could not be created. {error}
              </p>
            )}
            <Button icon={<Link2 aria-hidden className="size-5" />} onClick={() => void create()} loading={uploading} disabled={!passport} className="self-start">
              Create link
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {current.revoked ? (
              <p className="rounded-panel bg-grey-tint px-4 py-3 text-ink-2">This link is turned off. Anyone who opens it sees that it was revoked.</p>
            ) : (
              <>
                <QrCode value={current.url} label="QR code for the passport link" className="size-44 shrink-0 rounded-panel border border-line p-1" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">Expires {formatLocalDateTime(current.expiresAt)}</p>
                  <label htmlFor={linkInputId} className="mt-3 block text-secondary text-ink-3">
                    Link
                  </label>
                  <input
                    id={linkInputId}
                    readOnly
                    value={current.url}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 min-h-11 w-full rounded-button border border-line bg-surface-muted px-3 text-secondary text-ink"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={<Copy aria-hidden className="size-4" />} onClick={() => void copy(current.url)}>
                      Copy link
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Trash2 aria-hidden className="size-4" />}
                      onClick={() => void revoke.run(current.id)}
                      loading={revoke.pending}
                      className="!border-red-line !text-red-ink hover:!bg-red-tint"
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {others.length > 0 && (
          <section aria-labelledby="active-links-title" className="border-t border-line pt-5">
            <h3 id="active-links-title" className="text-[17px]">
              Other active links
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {others.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-surface-muted px-4 py-2">
                  <span className="text-secondary text-ink-2">Expires {formatLocalDateTime(l.expiresAt)}</span>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => void revoke.run(l.id)}
                    disabled={revoke.pending}
                    aria-label={`Revoke the link that expires ${formatLocalDateTime(l.expiresAt)}`}
                  >
                    Revoke
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
