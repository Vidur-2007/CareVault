import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`: moves focus into the container, keeps Tab inside it, calls onEscape on Escape,
 * locks page scroll, and restores focus to the previously focused element afterwards.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = container.current;
    const focusables = () =>
      node ? [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('data-focus-skip')) : [];

    const initial = node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? node;
    initial?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      // Give focus back only if nothing else took it meanwhile (e.g. an error handler that focused a
      // field while the dialog was animating out); otherwise typing would jump away mid-word.
      const now = document.activeElement;
      const unclaimed = !now || now === document.body || (node !== null && node.contains(now));
      if (unclaimed && previous && document.contains(previous)) previous.focus();
    };
  }, [active, container]);
}
