// Share links and the QR (UI spec 4.11, overview 9.7). The QR printed or shown for a passport is
// always the QR of a link to that exact snapshot. A link is never picked from a list by expiry (the
// v1 privacy bug): it is chosen by id, or among the links of that snapshot by when it was made.
import type { PassportSnapshot, ShareLink } from '../../../contract/types';
import { formatDate } from '../../lib/format';

/** Exact wording of UI spec 4.11. */
export const SHARE_EXPLANATION = 'The passport is encrypted on this device. Anyone with the link can read it until it expires.';
export const SHARE_UPLOAD_MESSAGE = 'Uploading the encrypted passport';

export const EXPIRY_HOURS = ['2', '8', '24'] as const;
export type ExpiryHours = (typeof EXPIRY_HOURS)[number];

export const isActive = (link: ShareLink, now: number = Date.now()) => !link.revoked && Date.parse(link.expiresAt) > now;

/** The active links of one snapshot, newest first. Links of other snapshots never appear. */
export function linksOfSnapshot(links: ShareLink[], snapshotId: string, now: number = Date.now()): ShareLink[] {
  return links
    .filter((l) => l.snapshotId === snapshotId && isActive(l, now))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * The link whose QR goes on this snapshot: the one asked for by id when it belongs to this snapshot
 * and is active, otherwise the newest active link of this snapshot, otherwise none.
 */
export function qrLinkFor(links: ShareLink[], snapshotId: string, preferredId: string | null, now: number = Date.now()): ShareLink | null {
  const own = linksOfSnapshot(links, snapshotId, now);
  return (preferredId ? own.find((l) => l.id === preferredId) : undefined) ?? own[0] ?? null;
}

/** "Passport 3 · prepared 14 Nov 2026". */
export const snapshotTitle = (s: Pick<PassportSnapshot, 'revision' | 'passport'>) =>
  `${s.revision ? `Passport ${s.revision}` : 'Passport'} · prepared ${formatDate(s.passport.preparedOn)}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
