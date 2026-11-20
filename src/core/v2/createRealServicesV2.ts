// The real implementation of contract v2, built step by step (docs/specs/01-core.spec.md).
// Each write loads what it needs, decides with pure rules, and stores the result in one
// transaction; subscribers hear once per write. Methods of later steps still reject with
// ServiceError('unknown', 'not built yet'): see the TEMPORARY list at the end.
import type { CareVaultServices } from '../../contract/services';
import { SAMPLE_DOCUMENT_FILES } from '../../contract/fixtures/sampleCase';
import {
  ServiceError,
  type CriticalField,
  type DocumentRecord,
  type ExtractionCandidate,
  type FieldEvidence,
  type DuplicateInfo,
  type ID,
  type ISODate,
  type Prescriber,
  type Profile,
  type ShareLink,
} from '../../contract/types';
import { createChangeNotifier } from '../db/events';
import { exportBackupV2, importBackupV2 } from './backup/backup';
import { byTime, createReposV2, type ReposV2 } from './db/repos';
import { CareVaultDbV2 } from './db/schema';
import { loadSampleProfiles } from './db/seed';
import { defaultReadingDepsV2, readFile, type ReadingDepsV2 } from './reading/read';
import { classify } from './rules/classify';
import { matchPatient, readPatientName } from './rules/patient';
import { applyDecisions, applyEvidence, buildEvidence, mergeEvidence, toExtractedLines } from './rules/verify';

export interface RealServicesV2Options {
  /** Defaults to the app database, 'carevault'. */
  db?: CareVaultDbV2;
  /** Defaults to the device clock. */
  now?: () => Date;
  /** Defaults to crypto.randomUUID(). */
  newId?: () => ID;
  /** Defaults to the browser's fetch. */
  fetch?: typeof fetch;
  /** PBKDF2 iterations for backups. Lower only in tests. */
  backupIterations?: number;
  /** PDF, OCR and cloud reading. Defaults to the real engines, loaded on first use. */
  reading?: ReadingDepsV2;
}

const FIELD_ORDER: readonly CriticalField[] = [
  'document_date', 'patient_name', 'medicine_name', 'ingredient', 'strength', 'unit', 'frequency', 'instruction',
];

/** Document-level fields first, then each line in order, its fields in reading order. */
function evidenceOrder(a: FieldEvidence, b: FieldEvidence): number {
  return (a.lineIndex ?? -1) - (b.lineIndex ?? -1)
    || (a.ingredientIndex ?? -1) - (b.ingredientIndex ?? -1)
    || FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field);
}

const CLOUD_READING_KEY = 'cloudReadingAllowed';

/** TEMPORARY: methods of later steps. */
const notBuilt = async (): Promise<never> => {
  throw new ServiceError('unknown', 'not built yet');
};

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

const notFound = (what: string) => new ServiceError('not_found', `This ${what} is not on this device.`);

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The type the browser reported, or one read from the first bytes when it gave none. */
export function detectMimeType(declared: string, bytes: ArrayBuffer): string | null {
  const type = declared.toLowerCase();
  if (type === 'application/pdf' || type.startsWith('image/')) return type;
  if (type && type !== 'application/octet-stream') return null;
  const head = new Uint8Array(bytes.slice(0, 12));
  const startsWith = (...signature: number[]) => signature.every((byte, i) => head[i] === byte);
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Newest clinical date first; undated records after dated ones, newest added first. */
export function newestDocumentFirst(a: DocumentRecord, b: DocumentRecord): number {
  if (a.clinicalDate && b.clinicalDate && a.clinicalDate !== b.clinicalDate) return b.clinicalDate.localeCompare(a.clinicalDate);
  if (a.clinicalDate && !b.clinicalDate) return -1;
  if (!a.clinicalDate && b.clinicalDate) return 1;
  return Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.id.localeCompare(b.id);
}

const cleanTags = (tags: readonly string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
const cleanList = (items: readonly string[]) => [...new Set(items.map((t) => t.trim()).filter(Boolean))];

function titleFromFile(file: Blob): string | null {
  const name = (file as Blob & { name?: unknown }).name;
  if (typeof name !== 'string' || !name.trim()) return null;
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim() || null;
}

export function createRealServicesV2(options: RealServicesV2Options = {}): CareVaultServices {
  const db = options.db ?? new CareVaultDbV2();
  const notifier = createChangeNotifier();
  const repos: ReposV2 = createReposV2(db, notifier);
  const clock = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const fetcher: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
  const nowIso = () => clock().toISOString();
  const reading = options.reading ?? defaultReadingDepsV2(fetcher);

  async function need<T>(row: Promise<T | undefined>, what: string): Promise<T> {
    const found = await row;
    if (found === undefined) throw notFound(what);
    return found;
  }

  const prescriberOf = async (profileId: ID, prescriberId: ID): Promise<Prescriber> => {
    const prescriber = await repos.prescribers.get(prescriberId);
    if (!prescriber || prescriber.profileId !== profileId) throw notFound('doctor');
    return prescriber;
  };

  async function loadFile(id: ID): Promise<DocumentRecord & { blob: Blob }> {
    const record = await need(repos.documents.get(id), 'record');
    const stored = await repos.files.get(id);
    if (stored) return { ...record, blob: stored };
    // The sample documents ship with the app instead of being stored.
    const sample = SAMPLE_DOCUMENT_FILES[id];
    if (!sample) throw new ServiceError('not_found', 'The original file is not stored on this device.');
    let response: Response;
    try {
      response = await fetcher(`/sample-docs/${sample}`);
    } catch {
      throw new ServiceError('network', 'The sample document could not be loaded. Check the connection.');
    }
    if (!response.ok) throw new ServiceError('not_found', 'The sample document could not be loaded.');
    return { ...record, blob: new Blob([await response.arrayBuffer()], { type: 'application/pdf' }) };
  }

  const isActiveLink = (link: ShareLink) => !link.revoked && Date.parse(link.expiresAt) > clock().getTime();

  const services: CareVaultServices = {
    profiles: {
      list: guarded(async () => (await repos.profiles.all()).sort(byTime((p) => p.createdAt))),

      create: guarded(async (input) => {
        const name = input.name.trim();
        if (!name) throw new ServiceError('unknown', 'Please enter a name.');
        const profile: Profile = {
          id: newId(),
          name,
          relation: input.relation.trim(),
          birthYear: input.birthYear,
          caregiverName: input.caregiverName.trim(),
          caregiverRelation: input.caregiverRelation.trim(),
          emergencyContact: input.emergencyContact?.trim() || null,
          createdAt: nowIso(),
        };
        return repos.profiles.put(profile);
      }),

      update: guarded(async (id, patch) => {
        const profile = await need(repos.profiles.get(id), 'profile');
        const next: Profile = { ...profile, ...patch, id: profile.id, createdAt: profile.createdAt };
        for (const key of ['name', 'relation', 'caregiverName', 'caregiverRelation'] as const) next[key] = next[key].trim();
        next.emergencyContact = next.emergencyContact?.trim() || null;
        if (!next.name) throw new ServiceError('unknown', 'Please enter a name.');
        return repos.profiles.put(next);
      }),

      loadSampleProfile: guarded(() => loadSampleProfiles(repos)),

      prescribers: guarded(async (profileId) =>
        (await repos.prescribers.byProfile(profileId)).sort((a, b) => a.name.localeCompare(b.name)),
      ),

      addPrescriber: guarded(async (profileId, input) => {
        const name = input.name.trim().replace(/\s+/g, ' ');
        if (!name) throw new ServiceError('unknown', "Please enter the doctor's name.");
        return repos.transaction(async () => {
          await need(repos.profiles.get(profileId), 'profile');
          const existing = (await repos.prescribers.byProfile(profileId)).find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (existing) return existing;
          return repos.prescribers.put({ id: newId(), profileId, name, specialty: input.specialty.trim() });
        });
      }),
    },

    documents: {
      add: guarded(async (profileId, file, meta) => {
        // Hash first: only database calls may run inside the transaction.
        const bytes = await file.arrayBuffer();
        const mimeType = detectMimeType(file.type, bytes);
        if (bytes.byteLength === 0 || mimeType === null) {
          throw new ServiceError('unsupported_file', 'Please choose a photo or a PDF.');
        }
        const sha256 = await sha256Hex(bytes);
        const blob = file.type === mimeType ? file : new Blob([bytes], { type: mimeType });

        return repos.transaction(async () => {
          await need(repos.profiles.get(profileId), 'profile');
          const earlier = (await repos.documents.bySha256(profileId, sha256)).sort(byTime((d) => d.addedAt))[0];
          const record: DocumentRecord = {
            id: newId(),
            profileId,
            kind: 'other',
            title: meta.title?.trim() || titleFromFile(file) || 'New record',
            clinicalDate: null,
            dateSource: 'unknown',
            addedAt: nowIso(),
            receivedAt: null,
            source: meta.source,
            state: 'pending_review',
            starred: false,
            prescriberId: null,
            facility: null,
            tags: [],
            testNames: [],
            patientNameRead: null,
            patientMatch: 'not_found',
            mimeType,
            sha256,
            pageCount: null,
            pagesRead: null,
          };
          // The original and its record are stored together, before any reading happens.
          await repos.documents.put(record);
          await repos.files.put(record.id, blob);
          const duplicate: DuplicateInfo | null = earlier
            ? { existingId: earlier.id, existingTitle: earlier.title, existingAddedAt: earlier.addedAt, exact: true }
            : null;
          return { record, duplicate };
        });
      }),

      get: guarded((id) => need(repos.documents.get(id), 'record')),

      list: guarded(async (profileId) => (await repos.documents.byProfile(profileId)).sort(newestDocumentFirst)),

      update: guarded(async (id, patch) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(id), 'record');
          const next: DocumentRecord = { ...doc };
          if (patch.title !== undefined) {
            const title = patch.title.trim();
            if (!title) throw new ServiceError('unknown', 'Please enter a title.');
            next.title = title;
          }
          if (patch.kind !== undefined) next.kind = patch.kind;
          if (patch.starred !== undefined) next.starred = patch.starred;
          if (patch.facility !== undefined) next.facility = patch.facility?.trim() || null;
          if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
          if (patch.testNames !== undefined) next.testNames = cleanList(patch.testNames);
          if (patch.clinicalDate !== undefined) {
            if (patch.clinicalDate !== null && !isIsoDate(patch.clinicalDate)) {
              throw new ServiceError('unknown', 'Please enter a real date.');
            }
            next.clinicalDate = patch.clinicalDate as ISODate | null;
            next.dateSource = patch.clinicalDate === null ? 'unknown' : 'user';
          }
          if (patch.prescriberId !== undefined) {
            if (patch.prescriberId !== null) await prescriberOf(doc.profileId, patch.prescriberId);
            next.prescriberId = patch.prescriberId;
          }
          return repos.documents.put(next);
        }),
      ),

      file: guarded(loadFile),

      fileRecord: guarded(async (id) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(id), 'record');
          return doc.state === 'filed' ? doc : repos.documents.put({ ...doc, state: 'filed' });
        }),
      ),

      remove: guarded(async (id) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(id), 'record');
          const removedAt = nowIso();

          // Snapshots keep their descriptor of the record and learn that the original is gone.
          const snapshotsMentioning: ID[] = [];
          for (const snapshot of await repos.snapshots.byProfile(doc.profileId)) {
            if (!snapshot.passport.documents?.some((d) => d.documentId === id)) continue;
            snapshotsMentioning.push(snapshot.id);
            await repos.snapshots.put({
              ...snapshot,
              passport: {
                ...snapshot.passport,
                documents: snapshot.passport.documents.map((d) => (d.documentId === id && d.removedAt === null ? { ...d, removedAt } : d)),
              },
            });
          }
          const activeShares: ShareLink[] = (await repos.shares.byProfile(doc.profileId))
            .filter((s) => s.snapshotId !== null && snapshotsMentioning.includes(s.snapshotId) && isActiveLink(s))
            // The revoke token never leaves storage.
            .map(({ id, profileId, snapshotId, url, createdAt, expiresAt, revoked }) => ({ id, profileId, snapshotId, url, createdAt, expiresAt, revoked }));

          for (const visit of await repos.visits.byProfile(doc.profileId)) {
            if (visit.sharedDocumentIds.includes(id)) {
              await repos.visits.put({ ...visit, sharedDocumentIds: visit.sharedDocumentIds.filter((d) => d !== id) });
            }
          }
          for (const proposal of await repos.proposals.byDocument(id)) await repos.proposals.delete(proposal.id);
          await repos.prescriptionLines.deleteByDocument(id);
          await repos.fieldEvidence.deleteByDocument(id);
          await repos.files.delete(id);
          await repos.documents.delete(id);
          return { snapshotsMentioning, activeShares };
        }),
      ),

      assignProfile: guarded(async (id, profileId) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(id), 'record');
          await need(repos.profiles.get(profileId), 'profile');
          if (doc.profileId === profileId) return doc;
          // A doctor belongs to one profile, so the link to the old profile's doctor is dropped.
          const moved: DocumentRecord = { ...doc, profileId, prescriberId: null, patientMatch: 'not_found' };
          for (const evidence of await repos.fieldEvidence.byDocument(id)) await repos.fieldEvidence.put({ ...evidence, profileId });
          for (const proposal of await repos.proposals.byDocument(id)) await repos.proposals.delete(proposal.id);
          return repos.documents.put(moved);
        }),
      ),

      fields: guarded(async (id) => {
        await need(repos.documents.get(id), 'record');
        return (await repos.fieldEvidence.byDocument(id)).sort(evidenceOrder);
      }),

      reviewFields: guarded(async (id, decisions) =>
        repos.transaction(async () => {
          await need(repos.documents.get(id), 'record');
          const current = await repos.fieldEvidence.byDocument(id);
          let next: FieldEvidence[];
          try {
            next = applyDecisions(current, decisions, nowIso());
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            throw message.startsWith('Unknown field') ? new ServiceError('not_found', 'This value is not part of this record.') : new ServiceError('unknown', 'Please enter the corrected value.');
          }
          await repos.fieldEvidence.bulkPut(next.filter((e, i) => e !== current[i]));
          return next.sort(evidenceOrder);
        }),
      ),
    },

    reading: {
      read: guarded(async (documentId, opts): Promise<ExtractionCandidate> => {
        // Reading happens before the transaction: OCR and the network may not run inside one.
        const file = await loadFile(documentId);
        const profile = await need(repos.profiles.get(file.profileId), 'profile');
        const result = await readFile(file.blob, { allowCloud: opts.allowCloud === true }, reading);

        const patientNameRead = readPatientName(result.parsed.text);
        const patientMatch = matchPatient(patientNameRead, profile.name);
        const classification = classify(result.parsed.text);
        const fresh = buildEvidence(
          { profileId: file.profileId, documentId, source: result.source, parsed: result.parsed, ocrLines: result.ocrLines, patientNameRead, patientMatch },
          { now: nowIso(), newId },
        );

        const fields = await repos.transaction(async () => {
          const doc = await need(repos.documents.get(documentId), 'record');
          const existing = await repos.fieldEvidence.byDocument(documentId);
          const merged = mergeEvidence(existing, fresh);
          const keep = new Set(merged.map((e) => e.id));
          await repos.fieldEvidence.bulkDelete(existing.filter((e) => !keep.has(e.id)).map((e) => e.id));
          await repos.fieldEvidence.bulkPut(merged);
          // Reading stores only what it learned about the file; the record's details are
          // suggestions in the candidate, for the user to accept with documents.update.
          await repos.documents.put({ ...doc, pageCount: result.pageCount, pagesRead: result.pagesRead, patientNameRead, patientMatch });
          return merged.sort(evidenceOrder);
        });

        return {
          documentId,
          kind: result.parsed.kind === 'prescription' ? 'prescription' : classification.kind,
          title: classification.title,
          clinicalDate: result.parsed.clinicalDate,
          prescriberName: result.parsed.prescriberName,
          facility: classification.facility,
          patientNameRead,
          patientMatch,
          tags: classification.tags,
          testNames: classification.testNames,
          lines: applyEvidence(toExtractedLines(result.parsed), fields),
          fields,
          engine: result.engine,
          rawText: result.parsed.text,
          pageCount: result.pageCount,
          pagesRead: result.pagesRead,
          needsCloud: false,
        };
      }),
    },
    prescriptions: { save: notBuilt, lines: notBuilt },   // TEMPORARY: step 6
    routine: {                                            // TEMPORARY: step 6 (totals: step 7)
      list: notBuilt, get: notBuilt, history: notBuilt, profileHistory: notBuilt, revision: notBuilt,
      add: notBuilt, update: notBuilt, setStatus: notBuilt, undo: notBuilt, proposalFor: notBuilt,
      decide: notBuilt, dismiss: notBuilt, resolveLegacy: notBuilt, ingredientTotals: notBuilt,
    },
    health: { list: notBuilt, add: notBuilt, remove: notBuilt },          // TEMPORARY: step 6
    attention: { list: notBuilt },                                        // TEMPORARY: step 7
    records: { search: notBuilt, ask: notBuilt },                         // TEMPORARY: step 7
    visits: {                                                             // TEMPORARY: step 8
      next: notBuilt, save: notBuilt, addQuestion: notBuilt, removeQuestion: notBuilt, setSharedDocuments: notBuilt,
    },
    passport: { live: notBuilt, snapshot: notBuilt, snapshots: notBuilt, getSnapshot: notBuilt },  // TEMPORARY: step 8
    sharing: { create: notBuilt, list: notBuilt, listUnowned: notBuilt, revoke: notBuilt, open: notBuilt },  // TEMPORARY: step 8
    gmail: { connect: notBuilt, findCandidates: notBuilt, importAttachment: notBuilt },  // TEMPORARY: step 9

    backup: {
      export: guarded((passphrase) => exportBackupV2(repos, passphrase, { iterations: options.backupIterations, now: clock })),
      import: guarded((file, passphrase) => importBackupV2(repos, file, passphrase, { now: clock, newId })),
    },

    settings: {
      get: guarded(async () => ({ cloudReadingAllowed: (await repos.settings.get<boolean>(CLOUD_READING_KEY)) === true })),
      setCloudReadingAllowed: guarded((value) => repos.settings.set(CLOUD_READING_KEY, value === true)),
    },

    subscribe: (listener) => notifier.subscribe(listener),
  };
  return services;
}
