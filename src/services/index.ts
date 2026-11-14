// src/services/index.ts  (frozen after Phase 0)
import type { CareVaultServices } from '../contract/services';
import { createMockServices } from '../ui/mock/createMockServices';
import { createRealServices } from '../core/createRealServices';

export const services: CareVaultServices =
  import.meta.env.VITE_USE_MOCK === 'true' ? createMockServices() : createRealServices();
