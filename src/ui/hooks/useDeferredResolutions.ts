// Answers to review items with Undo. The contract has no "unresolve", so the answer is held
// for the life of the toast (5 s) and sent to review.resolve only when the toast closes
// without Undo. Leaving the screen or the page sends held answers straight away.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewResolution } from '../../contract/types';
import { toServiceError } from './toServiceError';
import { useServices, useToast } from './useContexts';

interface Held {
  resolution: ReviewResolution;
  opts?: { keepMedicineId?: string };
  toastId: string;
}

export interface DeferredResolutions {
  /** Items answered but not yet sent (or sent and not yet gone from the list). */
  hidden: ReadonlySet<string>;
  answer: (itemId: string, resolution: ReviewResolution, message: string, opts?: Held['opts']) => void;
}

export function useDeferredResolutions(): DeferredResolutions {
  const services = useServices();
  const toast = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const held = useRef(new Map<string, Held>());

  const show = useCallback((id: string) => {
    setHidden((h) => {
      const next = new Set(h);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    async (id: string) => {
      const entry = held.current.get(id);
      if (!entry) return; // undone, or already sent
      held.current.delete(id);
      try {
        await services.review.resolve(id, entry.resolution, entry.opts);
      } catch (err) {
        toast.show({ message: `Your answer could not be saved. ${toServiceError(err).message}`, tone: 'error' });
        show(id);
      }
    },
    [services, toast, show],
  );

  const answer = useCallback<DeferredResolutions['answer']>(
    (itemId, resolution, message, opts) => {
      setHidden((h) => new Set(h).add(itemId));
      const toastId = toast.show({
        message,
        tone: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            held.current.delete(itemId);
            show(itemId);
          },
        },
        onExpire: () => void commit(itemId),
      });
      held.current.set(itemId, { resolution, opts, toastId });
    },
    [toast, show, commit],
  );

  // Send held answers when the screen unmounts or the page is hidden, so nothing is lost.
  useEffect(() => {
    const map = held.current;
    const flush = () => {
      const entries = [...map];
      map.clear();
      for (const [id, entry] of entries) {
        services.review.resolve(id, entry.resolution, entry.opts).catch(() => {});
        toast.dismiss(entry.toastId);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [services, toast]);

  return { hidden, answer };
}
