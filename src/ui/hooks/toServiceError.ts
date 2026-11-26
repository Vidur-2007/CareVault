import { ServiceError } from '../../contract/types';

type Code = ServiceError['code'];

/** UI spec section 8: caregiver-ready text for the codes whose own message is not shown. */
const FIXED: Partial<Record<Code, string>> = {
  not_configured: 'This feature is not set up on this copy of CareVault yet.',
  network: 'CareVault could not reach the server. Check the connection and try again.',
  stale: 'The routine changed since this was prepared. It has been refreshed.',
  verification_required: 'Check the highlighted value first.',
  locked_pdf: 'This PDF is password-protected. It is saved; fill in the details by hand.',
};

const CODES: readonly Code[] = [
  'not_found', 'cloud_consent_required', 'network', 'expired', 'revoked', 'bad_passphrase', 'unsupported_file',
  'locked_pdf', 'not_configured', 'verification_required', 'stale', 'unknown',
];

/**
 * Wording a caregiver can act on. HTTP status codes and setting names (seen in real service
 * messages such as "(503)" or "VITE_GOOGLE_CLIENT_ID is missing") never reach the screen.
 */
export function friendlyMessage(code: Code, message: string): string {
  const fixed = FIXED[code];
  if (fixed) return fixed;
  if (/\bVITE_[A-Z_]+\b|\bGEMINI_|\bSUPABASE_/.test(message)) return FIXED.not_configured!;
  const cleaned = message.replace(/\s*\(\d{3}\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || 'Something went wrong. Please try again.';
}

/** An error that carries a known service code: a v2 ServiceError, or one shaped like it. */
function serviceCode(err: unknown): Code | null {
  if (err instanceof ServiceError) return err.code;
  const code: unknown = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
  if (typeof code === 'string' && (CODES as readonly string[]).includes(code)) return code as Code;
  return null;
}

/** Every error the UI shows goes through here: a ServiceError with a friendly message. */
export function toServiceError(err: unknown): ServiceError {
  const code = serviceCode(err);
  if (code) {
    const original = (err as Error).message;
    const message = friendlyMessage(code, original);
    return err instanceof ServiceError && message === original ? err : new ServiceError(code, message);
  }
  const raw = err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
  return new ServiceError('unknown', friendlyMessage('unknown', raw));
}
