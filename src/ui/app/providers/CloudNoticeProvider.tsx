import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloudNoticeContext } from '../contexts';

/** Tracks requests that carry user data off the device, so the shell can show the CloudNotice. */
export function CloudNoticeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(0);

  const run = useCallback(async <R,>(message: string, fn: () => Promise<R>): Promise<R> => {
    const id = ++nextId.current;
    setActive((list) => [...list, { id, message }]);
    try {
      return await fn();
    } finally {
      setActive((list) => list.filter((n) => n.id !== id));
    }
  }, []);

  const value = useMemo(() => ({ message: active.at(-1)?.message ?? null, run }), [active, run]);
  return <CloudNoticeContext.Provider value={value}>{children}</CloudNoticeContext.Provider>;
}
