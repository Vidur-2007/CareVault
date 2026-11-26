import type { ReactNode } from 'react';
import type { CareVaultServices } from '../../../contract/services';
import { createServicesV2 } from '../../../services';
import { ServicesContext } from '../contexts';

let appServices: CareVaultServices | null = null;

/** createServicesV2() is a factory: it is called once, when the v2 app first needs it (overview section 6). */
function defaultServices(): CareVaultServices {
  appServices ??= createServicesV2();
  return appServices;
}

/** The UI's only bridge to an implementation. Tests pass `services={createMockServicesV2(...)}`. */
export function ServicesProvider({ services, children }: { services?: CareVaultServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services ?? defaultServices()}>{children}</ServicesContext.Provider>;
}
