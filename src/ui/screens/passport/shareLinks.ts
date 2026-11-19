import type { ShareLink } from '../../../contract/types';

/** Not revoked and not yet expired. */
export function isActive(link: ShareLink, now = Date.now()): boolean {
  return !link.revoked && Date.parse(link.expiresAt) > now;
}
