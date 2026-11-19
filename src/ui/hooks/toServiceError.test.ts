import { describe, expect, it } from 'vitest';
import { ServiceError } from '../../contract/types';
import { friendlyMessage, toServiceError } from './toServiceError';

describe('friendly error text', () => {
  it('never shows status codes or setting names', () => {
    expect(friendlyMessage('unknown', 'The link could not be created (503). Please try again.')).toBe('The link could not be created. Please try again.');
    expect(friendlyMessage('network', 'The passport could not be loaded (503).')).toBe('CareVault could not reach the server. Check the internet connection and try again.');
    expect(friendlyMessage('unknown', 'Gmail import is not set up: VITE_GOOGLE_CLIENT_ID is missing.')).toBe('This feature is not set up on this copy of CareVault yet.');
    expect(friendlyMessage('unknown', 'Connect Gmail first.')).toBe('Connect Gmail first.');
  });

  it('keeps the code and wraps non-service errors', () => {
    const e = toServiceError(new ServiceError('expired', 'This link has expired (410).'));
    expect(e).toBeInstanceOf(ServiceError);
    expect(e.code).toBe('expired');
    expect(e.message).toBe('This link has expired.');
    expect(toServiceError(new TypeError('Failed to fetch')).code).toBe('unknown');
  });
});
