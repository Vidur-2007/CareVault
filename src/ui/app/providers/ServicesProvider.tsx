import type { ReactNode } from 'react';
import type { CareVaultServices } from '../../../contract/legacy/services';
import { services as defaultServices } from '../../../services';
import { ServicesContext } from '../contexts';

/** The UI's only bridge to an implementation. Tests pass `services={createMockServices(...)}`. */
export function ServicesProvider({ services, children }: { services?: CareVaultServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services ?? defaultServices}>{children}</ServicesContext.Provider>;
}
