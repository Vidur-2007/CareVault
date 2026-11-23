import { useLayoutEffect } from 'react';

export const APP_NAME = 'CareVault';

/** "Records · CareVault". Every route sets one (UI spec section 3). */
export const pageTitle = (title: string) => `${title} · ${APP_NAME}`;

/** Set during commit, so the title never lags behind the page it names. */
export function useDocumentTitle(title: string) {
  useLayoutEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
