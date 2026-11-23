// The choices held on screen before "Save these choices" (UI spec 4.7). They are kept for this tab
// while the user goes to Check the values and comes back, keyed by row (see rowKey), and cleared
// once saved or when the review is put off with Not now.
import { useCallback, useState } from 'react';
import type { Held } from './reviewText';

const storageKey = (documentId: string) => `cv.review.${documentId}`;

function load(documentId: string): Record<string, Held> {
  try {
    const raw = sessionStorage.getItem(storageKey(documentId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Held>) : {};
  } catch {
    return {};
  }
}

function store(documentId: string, held: Record<string, Held>) {
  try {
    if (Object.keys(held).length === 0) sessionStorage.removeItem(storageKey(documentId));
    else sessionStorage.setItem(storageKey(documentId), JSON.stringify(held));
  } catch {
    // Storage may be unavailable; the choices still work for this visit.
  }
}

export function useHeldChoices(documentId: string) {
  const [held, setHeld] = useState<Record<string, Held>>(() => load(documentId));

  const update = useCallback((fn: (h: Record<string, Held>) => Record<string, Held>) => {
    setHeld((h) => {
      const next = fn(h);
      store(documentId, next);
      return next;
    });
  }, [documentId]);

  const choose = useCallback((key: string, value: Held) => update((h) => ({ ...h, [key]: value })), [update]);
  /** Forgets the given rows, or every row. */
  const forget = useCallback((keys?: string[]) => update((h) => {
    if (!keys) return {};
    const next = { ...h };
    for (const k of keys) delete next[k];
    return next;
  }), [update]);

  return { held, choose, forget };
}
