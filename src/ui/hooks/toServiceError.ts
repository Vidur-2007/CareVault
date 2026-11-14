import { ServiceError } from '../../contract/types';

export function toServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  const message = err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
  return new ServiceError('unknown', message);
}
