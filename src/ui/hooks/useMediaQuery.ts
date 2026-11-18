import { useSyncExternalStore } from 'react';

/** Matches a CSS media query; false where matchMedia is unavailable (tests, old browsers). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Desktop layout starts at 768 px (UI spec section 6). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
