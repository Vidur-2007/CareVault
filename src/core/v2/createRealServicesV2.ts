// PHASE 0 STUB for contract v2. Laptop A builds the real implementation step by step
// (docs/specs/01-core.spec.md). Until a method is built, it rejects with
// ServiceError('unknown', 'not built yet'). The v1 implementation, createRealServices.ts,
// keeps the current app running until the merge checkpoint.
import type { CareVaultServices } from '../../contract/services';
import { ServiceError } from '../../contract/types';

/** TEMPORARY: every method of contract v2 that is not built yet. */
const notBuilt = async (): Promise<never> => {
  throw new ServiceError('unknown', 'not built yet');
};

export function createRealServicesV2(): CareVaultServices {
  return {
    profiles: {
      list: notBuilt, create: notBuilt, update: notBuilt, loadSampleProfile: notBuilt,
      prescribers: notBuilt, addPrescriber: notBuilt,
    },
    documents: {
      add: notBuilt, get: notBuilt, list: notBuilt, update: notBuilt, file: notBuilt, fileRecord: notBuilt,
      remove: notBuilt, assignProfile: notBuilt, fields: notBuilt, reviewFields: notBuilt,
    },
    reading: { read: notBuilt },
    prescriptions: { save: notBuilt, lines: notBuilt },
    routine: {
      list: notBuilt, get: notBuilt, history: notBuilt, profileHistory: notBuilt, revision: notBuilt,
      add: notBuilt, update: notBuilt, setStatus: notBuilt, undo: notBuilt, proposalFor: notBuilt,
      decide: notBuilt, dismiss: notBuilt, resolveLegacy: notBuilt, ingredientTotals: notBuilt,
    },
    health: { list: notBuilt, add: notBuilt, remove: notBuilt },
    attention: { list: notBuilt },
    records: { search: notBuilt, ask: notBuilt },
    visits: {
      next: notBuilt, save: notBuilt, addQuestion: notBuilt, removeQuestion: notBuilt, setSharedDocuments: notBuilt,
    },
    passport: { live: notBuilt, snapshot: notBuilt, snapshots: notBuilt, getSnapshot: notBuilt },
    sharing: { create: notBuilt, list: notBuilt, listUnowned: notBuilt, revoke: notBuilt, open: notBuilt },
    gmail: { connect: notBuilt, findCandidates: notBuilt, importAttachment: notBuilt },
    backup: { export: notBuilt, import: notBuilt },
    settings: { get: notBuilt, setCloudReadingAllowed: notBuilt },
    subscribe: () => () => undefined,
  };
}
