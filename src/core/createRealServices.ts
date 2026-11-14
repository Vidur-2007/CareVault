// The real implementation of the contract: Dexie for storage, the rules engine for every
// decision. Each write loads the profile's state, asks the rules for a plan, and stores
// the plan in one transaction.
import type { CareVaultServices } from '../contract/services';
import { IDS, SAMPLE_TODAY } from '../contract/fixtures/sampleCase';
import {
  ServiceError,
  type DocumentRecord,
  type ID,
  type ISODate,
  type ISODateTime,
  type Medicine,
  type Profile,
  type Visit,
} from '../contract/types';
import { createChangeNotifier } from './db/events';
import { byTime, createRepos, type Repos } from './db/repos';
import { CareVaultDb } from './db/schema';
import { loadSampleProfile } from './db/seed';
import { defaultReadingDeps, readDocument, type ReadingDeps } from './reading/read';
import { buildChangeSummary, buildPassport } from './rules/passport';
import { buildDiff, planPrescriptionApply } from './rules/prescriptions';
import { planReviewResolution, withReviewRefresh } from './rules/review';
import { planAddMedicine, planConfirmMedicine, planSetStatus } from './rules/status';
import { ingredientTotals } from './rules/totals';
import { emptyPlan, type RuleContext, type RulesState, type WritePlan } from './rules/types';
import { nextVisit, planAddQuestion } from './rules/visits';
import { loadState, storePlan } from './state';

export interface RealServicesOptions {
  /** Defaults to the app database, `carevault`. */
  db?: CareVaultDb;
  /** Defaults to the device clock. */
  now?: () => Date;
  /** Defaults to `crypto.randomUUID()`. */
  newId?: () => ID;
  /** OCR, PDF and cloud reading. Defaults to the real engines, loaded on first use. */
  reading?: ReadingDeps;
  /** Defaults to the browser's `fetch`. */
  fetch?: typeof fetch;
}

/** The files in public/sample-docs/ behind the six documents of the sample profile. */
export const SAMPLE_DOCUMENT_FILES: Readonly<Record<ID, string>> = {
  [IDS.documents.lipidProfile]: 'lipid-profile-2026-11-12.pdf',
  [IDS.documents.raoLatest]: 'rx-rao-2026-10-28.pdf',
  [IDS.documents.ecg]: 'ecg-report-2026-09-15.pdf',
  [IDS.documents.hba1c]: 'hba1c-report-2026-11-12.pdf',
  [IDS.documents.raoPrevious]: 'rx-rao-2026-08-05.pdf',
  [IDS.documents.menon]: 'rx-menon-2026-07-14.pdf',
};

const CLOUD_READING_KEY = 'cloudReadingAllowed';

function localDate(date: Date): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong.';
  return new ServiceError('unknown', message);
}

/** Every method of the contract rejects with a ServiceError, whatever went wrong inside. */
function guarded<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw toServiceError(error);
    }
  };
}

const notBuiltYet = guarded(async (): Promise<never> => {
  throw new ServiceError('unknown', 'not built yet');
});

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/** The type the browser reported, or one read from the first bytes when it gave none. */
function detectMimeType(declared: string, bytes: ArrayBuffer): string | null {
  const type = declared.toLowerCase();
  if (type === 'application/pdf' || type.startsWith('image/')) return type;
  const head = new Uint8Array(bytes.slice(0, 4));
  const startsWith = (...signature: number[]) => signature.every((byte, i) => head[i] === byte);
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  return null;
}

const newestDocumentFirst = (a: DocumentRecord, b: DocumentRecord) =>
  b.documentDate.localeCompare(a.documentDate) || Date.parse(b.addedAt) - Date.parse(a.addedAt);

export function createRealServices(options: RealServicesOptions = {}): CareVaultServices {
  const db = options.db ?? new CareVaultDb();
  const notifier = createChangeNotifier();
  const repos: Repos = createRepos(db, notifier);
  const clock = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const reading = options.reading ?? defaultReadingDeps();
  const fetcher: typeof fetch = options.fetch ?? ((...args) => fetch(...args));

  const nowIso = (): ISODateTime => clock().toISOString();

  /**
   * "Today" for a profile. The sample profile is a fixed demo case whose visit is on
   * 18 November 2026; its calendar stays on the sample date so the case keeps working
   * after that day, exactly as the mock does.
   */
  const todayFor = (profileId: ID): ISODate => (profileId === IDS.profile ? SAMPLE_TODAY : localDate(clock()));

  const contextFor = (profileId: ID): RuleContext => ({
    now: nowIso(),
    today: todayFor(profileId),
    newId: () => newId(),
  });

  /**
   * One write: load the state, let the rules plan, refresh the review inbox, store
   * everything together, and build the result from the state as it now is.
   */
  async function change<R>(
    profileId: ID,
    build: (state: RulesState, ctx: RuleContext) => WritePlan,
    result: (after: RulesState, plan: WritePlan) => R,
  ): Promise<R> {
    return repos.transaction(async () => {
      const state = await loadState(repos, profileId);
      const ctx = contextFor(profileId);
      const plan = withReviewRefresh(state, build(state, ctx), ctx);
      return result(await storePlan(repos, state, plan), plan);
    });
  }

  async function need<T>(row: Promise<T | undefined>, what: string): Promise<T> {
    const found = await row;
    if (found === undefined) throw new ServiceError('not_found', `This ${what} is not on this device.`);
    return found;
  }

  const medicineIn = (state: RulesState, id: ID): Medicine => {
    const medicine = state.medicines.find((m) => m.id === id);
    if (!medicine) throw new ServiceError('not_found', 'This medicine is not on this device.');
    return medicine;
  };

  const documentIn = (state: RulesState, id: ID): DocumentRecord => {
    const doc = state.documents.find((d) => d.id === id);
    if (!doc) throw new ServiceError('not_found', 'This document is not on this device.');
    return doc;
  };

  const visitIn = (state: RulesState, id: ID): Visit => {
    const visit = state.visits.find((v) => v.id === id);
    if (!visit) throw new ServiceError('not_found', 'This visit is not on this device.');
    return visit;
  };

  const withVisit = (visit: Visit): WritePlan => ({ ...emptyPlan(), visits: [visit] });
  const withDocument = (doc: DocumentRecord): WritePlan => ({ ...emptyPlan(), documents: [doc] });

  const services: CareVaultServices = {
    profiles: {
      list: guarded(async () => (await repos.profiles.all()).sort(byTime((p) => p.createdAt))),

      create: guarded(async (input) => {
        const name = input.name.trim();
        if (!name) throw new ServiceError('unknown', 'Please enter a name.');
        const profile: Profile = {
          name,
          relation: input.relation.trim(),
          birthYear: input.birthYear,
          caregiverName: input.caregiverName.trim(),
          caregiverRelation: input.caregiverRelation.trim(),
          id: newId(),
          createdAt: nowIso(),
        };
        return repos.profiles.put(profile);
      }),

      loadSampleProfile: guarded(() => loadSampleProfile(repos)),

      prescribers: guarded(async (profileId) =>
        (await repos.prescribers.byProfile(profileId)).sort((a, b) => a.name.localeCompare(b.name)),
      ),
    },

    medicines: {
      list: guarded(async (profileId) => (await repos.medicines.byProfile(profileId)).sort(byTime((m) => m.createdAt))),

      get: guarded((id) => need(repos.medicines.get(id), 'medicine')),

      history: guarded(async (medicineId) => {
        await need(repos.medicines.get(medicineId), 'medicine');
        return repos.events.byMedicine(medicineId);
      }),

      addFromLine: guarded((profileId, line, opts) =>
        change(
          profileId,
          (state, ctx) => {
            const prescriberId = opts.documentId ? documentIn(state, opts.documentId).prescriberId : null;
            return planAddMedicine(profileId, line, { ...opts, prescriberId }, ctx);
          },
          (_after, plan) => plan.medicines[0],
        ),
      ),

      confirm: guarded(async (id, patch) => {
        const { profileId } = await need(repos.medicines.get(id), 'medicine');
        return change(
          profileId,
          (state, ctx) => planConfirmMedicine(medicineIn(state, id), patch, ctx),
          (after) => medicineIn(after, id),
        );
      }),

      setStatus: guarded(async (id, status) => {
        const { profileId } = await need(repos.medicines.get(id), 'medicine');
        return change(
          profileId,
          (state, ctx) => planSetStatus(medicineIn(state, id), status, ctx),
          (after) => medicineIn(after, id),
        );
      }),

      ingredientTotals: guarded(async (profileId) => ingredientTotals(await repos.medicines.byProfile(profileId))),
    },

    reading: {
      read: guarded((file, opts) => readDocument(file, { allowCloud: opts.allowCloud === true }, reading)),
    },

    documents: {
      list: guarded(async (profileId) => (await repos.documents.byProfile(profileId)).sort(newestDocumentFirst)),

      get: guarded((id) => need(repos.documents.get(id), 'document')),

      add: guarded(async (profileId, file, meta) => {
        // Hash first: nothing but database calls may run inside the transaction.
        const bytes = await file.arrayBuffer();
        const mimeType = detectMimeType(file.type, bytes);
        if (bytes.byteLength === 0 || mimeType === null) {
          throw new ServiceError('unsupported_file', 'Please choose a photo or a PDF.');
        }
        const sha256 = await sha256Hex(bytes);
        const blob = file.type === mimeType ? file : new Blob([bytes], { type: mimeType });

        return repos.transaction(async () => {
          const state = await loadState(repos, profileId);
          const earlier = state.documents
            .filter((d) => d.sha256 === sha256)
            .sort(byTime((d) => d.addedAt))[0];
          const record: DocumentRecord = {
            type: meta.type,
            title: meta.title.trim(),
            documentDate: meta.documentDate,
            source: meta.source,
            prescriberId: meta.prescriberId,
            id: newId(),
            profileId,
            state: 'pending_confirmation',
            starred: false,
            mimeType,
            sha256,
            addedAt: nowIso(),
          };
          const ctx = contextFor(profileId);
          await storePlan(repos, state, withReviewRefresh(state, withDocument(record), ctx));
          await repos.files.put(record.id, blob);
          return { record, duplicateOf: earlier?.id ?? null };
        });
      }),

      confirm: guarded(async (id) => {
        const { profileId } = await need(repos.documents.get(id), 'document');
        return change(
          profileId,
          (state) => {
            const doc = documentIn(state, id);
            return doc.state === 'confirmed' ? emptyPlan() : withDocument({ ...doc, state: 'confirmed' });
          },
          (after) => documentIn(after, id),
        );
      }),

      remove: guarded(async (id) => {
        const { profileId } = await need(repos.documents.get(id), 'document');
        await change(
          profileId,
          () => ({ ...emptyPlan(), deletedDocumentIds: [id] }),
          () => undefined,
        );
      }),

      star: guarded(async (id, starred) => {
        const { profileId } = await need(repos.documents.get(id), 'document');
        return change(
          profileId,
          (state) => withDocument({ ...documentIn(state, id), starred }),
          (after) => documentIn(after, id),
        );
      }),

      file: guarded(async (id) => {
        await need(repos.documents.get(id), 'document');
        const blob = await repos.files.get(id);
        if (blob) return blob;
        // The sample profile's documents ship with the app instead of being stored.
        const sample = SAMPLE_DOCUMENT_FILES[id];
        if (!sample) throw new ServiceError('not_found', 'The original file is not stored on this device.');
        let response: Response;
        try {
          response = await fetcher(`/sample-docs/${sample}`);
        } catch {
          throw new ServiceError('network', 'The sample document could not be loaded. Check the connection.');
        }
        if (!response.ok) throw new ServiceError('not_found', 'The sample document could not be loaded.');
        return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
      }),

      search: guarded(async (profileId, text) => {
        const query = text.trim().toLowerCase();
        return (await repos.documents.byProfile(profileId))
          .filter(
            (d) => !query || d.title.toLowerCase().includes(query) || d.type.replace(/_/g, ' ').includes(query),
          )
          .sort(newestDocumentFirst);
      }),
    },

    prescriptions: {
      apply: guarded(async (profileId, documentId, prescriberId, lines) => {
        if (lines.length === 0) throw new ServiceError('unknown', 'Please add at least one medicine line.');
        return change(
          profileId,
          (state, ctx) => planPrescriptionApply(state, prescriberId, documentId, lines, ctx),
          (after) => {
            // A prescription applied earlier keeps the prescriber it was filed under.
            const filedUnder = documentIn(after, documentId).prescriberId ?? prescriberId;
            const diff = buildDiff(after, filedUnder, documentId);
            if (!diff) throw new ServiceError('unknown', 'This prescription could not be compared.');
            return diff;
          },
        );
      }),

      latestDiff: guarded(async (profileId, prescriberId) => buildDiff(await loadState(repos, profileId), prescriberId)),
    },

    review: {
      listOpen: guarded((profileId) => repos.reviewItems.openByProfile(profileId)),

      resolve: guarded(async (id, resolution, opts) => {
        const { profileId } = await need(repos.reviewItems.get(id), 'review item');
        await change(
          profileId,
          (state, ctx) => {
            const item = state.reviewItems.find((r) => r.id === id);
            if (!item) throw new ServiceError('not_found', 'This review item is not on this device.');
            return planReviewResolution(state, item, resolution, opts, ctx);
          },
          () => undefined,
        );
      }),
    },

    visits: {
      next: guarded(async (profileId) => nextVisit(await loadState(repos, profileId), todayFor(profileId))),

      save: guarded((visit) =>
        change(
          visit.profileId,
          (state) => {
            if (!state.prescribers.some((p) => p.id === visit.prescriberId)) {
              throw new ServiceError('not_found', 'This prescriber is not on this device.');
            }
            if (Number.isNaN(Date.parse(visit.at))) throw new ServiceError('unknown', 'Please enter the date and time of the visit.');
            const known = new Set(state.documents.map((d) => d.id));
            return withVisit({
              id: visit.id ?? newId(),
              profileId: visit.profileId,
              prescriberId: visit.prescriberId,
              at: visit.at,
              questions: visit.questions,
              sharedDocumentIds: [...new Set(visit.sharedDocumentIds)].filter((id) => known.has(id)),
            });
          },
          (_after, plan) => plan.visits[0],
        ),
      ),

      addQuestion: guarded(async (visitId, text) => {
        const { profileId } = await need(repos.visits.get(visitId), 'visit');
        return change(
          profileId,
          (state, ctx) => planAddQuestion(visitIn(state, visitId), text, 'manual', ctx),
          (after) => visitIn(after, visitId),
        );
      }),

      removeQuestion: guarded(async (visitId, questionId) => {
        const { profileId } = await need(repos.visits.get(visitId), 'visit');
        return change(
          profileId,
          (state) => {
            const visit = visitIn(state, visitId);
            return withVisit({ ...visit, questions: visit.questions.filter((q) => q.id !== questionId) });
          },
          (after) => visitIn(after, visitId),
        );
      }),

      setSharedDocuments: guarded(async (visitId, documentIds) => {
        const { profileId } = await need(repos.visits.get(visitId), 'visit');
        return change(
          profileId,
          (state) => {
            const known = new Set(state.documents.map((d) => d.id));
            const sharedDocumentIds = [...new Set(documentIds)].filter((id) => known.has(id));
            return withVisit({ ...visitIn(state, visitId), sharedDocumentIds });
          },
          (after) => visitIn(after, visitId),
        );
      }),

      changeSummary: guarded(async (profileId) =>
        buildChangeSummary(await loadState(repos, profileId), todayFor(profileId)),
      ),

      buildPassport: guarded(async (profileId) => buildPassport(await loadState(repos, profileId), todayFor(profileId))),
    },

    sharing: {
      create: notBuiltYet,
      list: notBuiltYet,
      revoke: notBuiltYet,
      open: notBuiltYet,
    },

    gmail: {
      connect: notBuiltYet,
      findCandidates: notBuiltYet,
      importAttachment: notBuiltYet,
    },

    backup: {
      export: notBuiltYet,
      import: notBuiltYet,
    },

    settings: {
      get: guarded(async () => ({
        cloudReadingAllowed: (await repos.settings.get<boolean>(CLOUD_READING_KEY)) === true,
      })),

      setCloudReadingAllowed: guarded((value) => repos.settings.set(CLOUD_READING_KEY, value === true)),
    },

    subscribe: (listener) => notifier.subscribe(listener),
  };

  return services;
}
