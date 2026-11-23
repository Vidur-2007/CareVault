// Runs a write through the services, tracks pending state, and shows a toast:
// success (optional message) or the ServiceError message on failure.
//
//   const star = useServiceAction((s, id: string, on: boolean) => s.documents.star(id, on),
//     { success: (doc) => (doc.starred ? 'Starred' : 'Unstarred') });
//   await star.run(doc.id, true);
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareVaultServices } from '../../contract/services';
import type { ServiceError } from '../../contract/types';
import { useServices, useToast } from './useContexts';
import { toServiceError } from './toServiceError';

export interface ServiceActionOptions<R> {
  success?: string | ((result: R) => string | null);
  /** Prefix for the error toast, e.g. 'Could not save'. */
  errorPrefix?: string;
  /** Rethrow after showing the error toast. Default false: run() resolves to undefined. */
  rethrow?: boolean;
}

export interface ServiceAction<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  error: ServiceError | null;
}

export function useServiceAction<A extends unknown[], R>(
  fn: (services: CareVaultServices, ...args: A) => Promise<R>,
  options: ServiceActionOptions<R> = {},
): ServiceAction<A, R> {
  const services = useServices();
  const toast = useToast();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<ServiceError | null>(null);

  const latest = useRef({ fn, options });
  useEffect(() => {
    latest.current = { fn, options };
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A) => {
      const { fn: call, options: opts } = latest.current;
      setPending((n) => n + 1);
      setError(null);
      try {
        const result = await call(services, ...args);
        const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
        if (message) toast.show({ message, tone: 'success' });
        return result;
      } catch (err) {
        const e = toServiceError(err);
        if (mounted.current) setError(e);
        toast.show({ message: opts.errorPrefix ? `${opts.errorPrefix}. ${e.message}` : e.message, tone: 'error' });
        if (opts.rethrow) throw e;
        return undefined;
      } finally {
        if (mounted.current) setPending((n) => n - 1);
      }
    },
    [services, toast],
  );

  return { run, pending: pending > 0, error };
}
