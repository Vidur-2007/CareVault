// The active share links of a profile (UI spec 4.11, from sharing.list): which passport each opens,
// when it expires, Copy link and Revoke. No QR here: a QR is only shown for one chosen link.
import { Copy, Link2, Trash2 } from 'lucide-react';
import type { ShareLink } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToast } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { formatLocalDateTime } from '../../lib/format';
import { copyText } from './shareLinks';

export interface ActiveLinksProps {
  links: ShareLink[];
  /** "Passport 3" for a snapshot id, when the list covers several snapshots. */
  labelFor?: (snapshotId: string | null) => string;
  title?: string;
  onChanged?: () => void;
}

export function ActiveLinks({ links, labelFor, title = 'Active links', onChanged }: ActiveLinksProps) {
  const toast = useToast();
  const revoke = useServiceAction((s, id: string) => s.sharing.revoke(id), { success: 'The link is turned off' });
  if (links.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="active-links-title">
      <h2 id="active-links-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
        <Link2 aria-hidden className="size-5 text-ink-3" />
        {title}
      </h2>
      <p className="mt-1 text-secondary text-ink-3">Anyone with one of these links can read that passport until it expires.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((l) => {
          const label = `${labelFor ? `${labelFor(l.snapshotId)} · ` : ''}expires ${formatLocalDateTime(l.expiresAt)}`;
          return (
            <li key={l.id} className="flex flex-col gap-2 rounded-panel bg-surface-muted px-4 py-3">
              <span className="text-ink">{label[0].toUpperCase() + label.slice(1)}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy aria-hidden className="size-4" />}
                  aria-label={`Copy the link: ${label}`}
                  onClick={async () => toast.show(await copyText(l.url) ? { message: 'Link copied', tone: 'success' } : { message: l.url, tone: 'info' })}
                >
                  Copy link
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  aria-label={`Revoke the link: ${label}`}
                  loading={revoke.pending}
                  className="!border-red-line !text-red-ink hover:!bg-red-tint"
                  onClick={async () => {
                    await revoke.run(l.id);
                    onChanged?.();
                  }}
                >
                  Revoke
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
