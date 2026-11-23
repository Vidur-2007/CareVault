// The deferred-Undo pattern kept from the v1 Review screen (UI spec section 2): an answer hides its
// item at once and shows a toast with Undo. The write is held for the life of the toast (5 s) and
// sent only when the toast closes without Undo. Leaving the screen or the page sends held writes
// straight away, so nothing is lost.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toServiceError } from './toServiceError';
import { useToast } from './useContexts';

interface Held {
  commit: () => Promise<unknown>;
  toastId: string;
}

export interface DeferredCommits {
  /** Items answered but not yet sent, or sent and not yet gone from the list. */
  hidden: ReadonlySet<string>;
  /** Hides the item, shows `message` with Undo, and runs `commit` when the toast closes. */
  answer: (itemId: string, message: string, commit: () => Promise<unknown>) => void;
}

export function useDeferredCommits(): DeferredCommits {
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

  const send = useCallback(
    async (id: string) => {
      const entry = held.current.get(id);
      if (!entry) return; // undone, or already sent
      held.current.delete(id);
      try {
        await entry.commit();
      } catch (err) {
        toast.show({ message: `Your answer could not be saved. ${toServiceError(err).message}`, tone: 'error' });
        show(id);
      }
    },
    [toast, show],
  );

  const answer = useCallback<DeferredCommits['answer']>(
    (itemId, message, commit) => {
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
        onExpire: () => void send(itemId),
      });
      held.current.set(itemId, { commit, toastId });
    },
    [toast, show, send],
  );

  useEffect(() => {
    const map = held.current;
    const flush = () => {
      const entries = [...map.values()];
      map.clear();
      for (const entry of entries) {
        entry.commit().catch(() => {});
        toast.dismiss(entry.toastId);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [toast]);

  return { hidden, answer };
}
