import { ServiceError } from '../../contract/types';

const NETWORK_MESSAGE = 'CareVault could not reach the server. Check the internet connection and try again.';
const NOT_SET_UP_MESSAGE = 'This feature is not set up on this copy of CareVault yet.';

/**
 * Wording a caregiver can act on. HTTP status codes and setting names (seen in real service
 * messages such as "(503)" or "VITE_GOOGLE_CLIENT_ID is missing") never reach the screen.
 */
export function friendlyMessage(code: ServiceError['code'], message: string): string {
  if (code === 'network') return NETWORK_MESSAGE;
  if (/\bVITE_[A-Z_]+\b|\bGEMINI_|\bSUPABASE_/.test(message)) return NOT_SET_UP_MESSAGE;
  const cleaned = message.replace(/\s*\(\d{3}\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || 'Something went wrong. Please try again.';
}

/** Every error the UI shows goes through here: a ServiceError with a friendly message. */
export function toServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) {
    const message = friendlyMessage(err.code, err.message);
    return message === err.message ? err : new ServiceError(err.code, message);
  }
  const raw = err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
  return new ServiceError('unknown', friendlyMessage('unknown', raw));
}
