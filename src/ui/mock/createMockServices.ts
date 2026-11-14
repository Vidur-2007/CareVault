import type { CareVaultServices } from '../../contract/services';
import { ServiceError } from '../../contract/types';

// Phase 0 stub. The UI side replaces this with the in-memory mock.
const notImplemented = (): never => {
  throw new ServiceError('unknown', 'not implemented');
};

export function createMockServices(): CareVaultServices {
  return {
    profiles: {
      list: notImplemented,
      create: notImplemented,
      loadSampleProfile: notImplemented,
      prescribers: notImplemented,
    },
    medicines: {
      list: notImplemented,
      get: notImplemented,
      history: notImplemented,
      addFromLine: notImplemented,
      confirm: notImplemented,
      setStatus: notImplemented,
      ingredientTotals: notImplemented,
    },
    reading: {
      read: notImplemented,
    },
    documents: {
      list: notImplemented,
      get: notImplemented,
      add: notImplemented,
      confirm: notImplemented,
      remove: notImplemented,
      star: notImplemented,
      file: notImplemented,
      search: notImplemented,
    },
    prescriptions: {
      apply: notImplemented,
      latestDiff: notImplemented,
    },
    review: {
      listOpen: notImplemented,
      resolve: notImplemented,
    },
    visits: {
      next: notImplemented,
      save: notImplemented,
      addQuestion: notImplemented,
      removeQuestion: notImplemented,
      setSharedDocuments: notImplemented,
      changeSummary: notImplemented,
      buildPassport: notImplemented,
    },
    sharing: {
      create: notImplemented,
      list: notImplemented,
      revoke: notImplemented,
      open: notImplemented,
    },
    gmail: {
      connect: notImplemented,
      findCandidates: notImplemented,
      importAttachment: notImplemented,
    },
    backup: {
      export: notImplemented,
      import: notImplemented,
    },
    settings: {
      get: notImplemented,
      setCloudReadingAllowed: notImplemented,
    },
    subscribe: notImplemented,
  };
}
