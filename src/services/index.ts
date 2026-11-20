// src/services/index.ts  (frozen; changed only through a contract request)
//
// During the v2 build both contracts exist side by side:
// - `services` (contract v1, src/contract/legacy) keeps the current app running. TEMPORARY:
//   removed at the merge checkpoint, when the app switches to v2.
// - `createServicesV2()` (contract v2, src/contract) is what both laptops build against.
//   It is a factory so that the v1 and v2 databases are never opened in the same page.
import type { CareVaultServices as LegacyServices } from '../contract/legacy/services';
import type { CareVaultServices } from '../contract/services';
import { createMockServices } from '../ui/mock/createMockServices';
import { createMockServicesV2 } from '../ui/mock/v2/createMockServicesV2';
import { createRealServices } from '../core/createRealServices';
import { createRealServicesV2 } from '../core/v2/createRealServicesV2';

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const services: LegacyServices = useMock ? createMockServices() : createRealServices();

export function createServicesV2(): CareVaultServices {
  return useMock ? createMockServicesV2() : createRealServicesV2();
}
