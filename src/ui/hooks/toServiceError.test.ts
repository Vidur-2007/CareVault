import { describe, expect, it } from 'vitest';
import { ServiceError } from '../../contract/types';
import { friendlyMessage, toServiceError } from './toServiceError';

describe('friendly error text (UI spec section 8)', () => {
  it('maps the v2 codes to fixed wording', () => {
    expect(friendlyMessage('not_configured', 'VITE_GOOGLE_CLIENT_ID is missing')).toBe('This feature is not set up on this copy of CareVault yet.');
    expect(friendlyMessage('network', 'The passport could not be loaded (503).')).toBe('CareVault could not reach the server. Check the connection and try again.');
    expect(friendlyMessage('stale', 'revision 4 != 5')).toBe('The routine changed since this was prepared. It has been refreshed.');
    expect(friendlyMessage('verification_required', 'line 3 unverified')).toBe('Check the highlighted value first.');
    expect(friendlyMessage('locked_pdf', 'PasswordException')).toBe('This PDF is password-protected. It is saved; fill in the details by hand.');
  });

  it('keeps the service message for other codes, without status codes or setting names', () => {
    expect(friendlyMessage('unknown', 'The link could not be created (503). Please try again.')).toBe('The link could not be created. Please try again.');
    expect(friendlyMessage('unknown', 'Gmail import is not set up: VITE_GOOGLE_CLIENT_ID is missing.')).toBe('This feature is not set up on this copy of CareVault yet.');
    expect(friendlyMessage('expired', 'This link has expired.')).toBe('This link has expired.');
  });

  it('keeps the code and wraps non-service errors', () => {
    const e = toServiceError(new ServiceError('expired', 'This link has expired (410).'));
    expect(e).toBeInstanceOf(ServiceError);
    expect(e.code).toBe('expired');
    expect(e.message).toBe('This link has expired.');
    const same = new ServiceError('revoked', 'This link was turned off.');
    expect(toServiceError(same)).toBe(same);
    expect(toServiceError(new TypeError('Failed to fetch')).code).toBe('unknown');
  });
});
