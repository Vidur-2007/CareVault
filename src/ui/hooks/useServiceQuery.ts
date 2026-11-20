// Runs an async services call, returns { data, loading, error, reload },
// and re-runs when services.subscribe() fires.
//
//   const { data: items, loading, error } = useServiceQuery(
//     (s) => s.review.listOpen(profileId), [profileId]);
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import type { CareVaultServices } from '../../contract/legacy/services';
import type { ServiceError } from '../../contract/legacy/types';
import { useServices } from './useContexts';
import { toServiceError } from './toServiceError';

export interface ServiceQuery<R> {
  data: R | undefined;
  /** True until the first result (or error) for the current deps. Refetches keep showing data. */
  loading: boolean;
  error: ServiceError | null;
  reload: () => void;
}

interface QueryState<R> {
  key: string;
  data: R | undefined;
  error: ServiceError | null;
  settled: boolean;
}

export function useServiceQuery<R>(
  fn: (services: CareVaultServices) => Promise<R>,
  deps: DependencyList,
  options: { enabled?: boolean } = {},
): ServiceQuery<R> {
  const services = useServices();
  const enabled = options.enabled ?? true;
  const key = JSON.stringify(deps);

  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const [state, setState] = useState<QueryState<R>>({ key, data: undefined, error: null, settled: false });
  const requestId = useRef(0);

  const run = useCallback(() => {
    const id = ++requestId.current;
    fnRef.current(services).then(
      (data) => {
        if (id === requestId.current) setState({ key, data, error: null, settled: true });
      },
      (err: unknown) => {
        if (id === requestId.current) {
          setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: toServiceError(err), settled: true }));
        }
      },
    );
  }, [services, key]);

  useEffect(() => {
    if (!enabled) return;
    run();
    const unsubscribe = services.subscribe(run);
    return () => {
      unsubscribe();
      requestId.current += 1; // ignore responses that arrive after deps change or unmount
    };
  }, [services, run, enabled]);

  // Results for older deps are never shown.
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    loading: enabled && (!current || !state.settled),
    error: current ? state.error : null,
    reload: run,
  };
}
