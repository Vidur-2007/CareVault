import { useEffect, useState } from 'react';
import type { ServiceError } from '../../contract/types';
import { toServiceError } from './toServiceError';
import { useServices } from './useContexts';

/**
 * The original file, fetched once per record. Not a subscribed query: other writes (a star, an
 * edit) must not fetch it again and restart the preview.
 */
export function useOriginal(id: string, enabled: boolean) {
  const services = useServices();
  const [state, setState] = useState<{ id: string; blob: Blob | null; error: ServiceError | null }>({ id: '', blob: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    services.documents.file(id).then(
      (f) => !cancelled && setState({ id, blob: f.blob, error: null }),
      (err: unknown) => !cancelled && setState({ id, blob: null, error: toServiceError(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [services, id, enabled]);
  return state.id === id ? state : { blob: null, error: null };
}

