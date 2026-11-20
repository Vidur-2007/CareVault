// The real implementation of contract v2, built step by step (docs/specs/01-core.spec.md).
// Each write loads what it needs, decides with pure rules, and stores the result in one
// transaction; subscribers hear once per write. Every method of contract v2 is built.
import type { CareVaultServices } from '../../contract/services';
import { SAMPLE_DOCUMENT_FILES } from '../../contract/fixtures/sampleCase';
import {
  ServiceError,
  type CriticalField,
  type DocumentRecord,
  type ExtractionCandidate,
  type FieldEvidence,
  type GmailCandidate,
  type DuplicateInfo,
  type HealthEntry,
  type HealthEntryKind,
  type ID,
  type ISODate,
  type PrescriptionLine,
  type Prescriber,
  type Profile,
  type RoutineMedicine,
  type RoutineStatus,
  type Question,
  type ShareLink,
  type Visit,
} from '../../contract/types';
import type { Medicine as LegacyMedicine } from '../../contract/legacy/types';
import { todayFor } from '../../contract/today';
import { ingredientTotals } from '../rules/totals';
import { normalizeIngredients } from '../rules/normalize';
import { createChangeNotifier } from '../db/events';
import { exportBackupV2, importBackupV2 } from './backup/backup';
import { byTime, createReposV2, type ReposV2 } from './db/repos';
import { CareVaultDbV2 } from './db/schema';
import { loadSampleProfiles } from './db/seed';
import { defaultReadingDepsV2, readFile, type ReadingDepsV2 } from './reading/read';
import { classify } from './rules/classify';
import { matchPatient, readPatientName } from './rules/patient';
import { applyDecisions, applyEvidence, buildEvidence, mergeEvidence, toExtractedLines } from './rules/verify';
import { attentionItems } from './rules/attention';
import { documentsText, normalizeQuestion, parseQuestion, questionsAnswer, routineAnswer, HINT } from './rules/ask';
import { planDecisions, rebuildWith } from './rules/decide';
import { buildPassport, planSnapshot } from './rules/passport';
import { newestFirst, searchRecords } from './rules/search';
import { downloadSnapshot, revokeLink, uploadSnapshot } from './share/client';
import { createTokenSource, type TokenSource } from '../gmail/token';
import { downloadAttachment, findCandidates as findGmailCandidates, MESSAGES as GMAIL_MESSAGES } from './gmail/api';
import { buildProposal, hasNothingToAsk, sameProposal, toPublic, type StoredProposal } from './rules/proposal';
import {
  assertLineReviewable,
  confirmExtracted,
  isLineVerified,
  planAdd,
  planHealthAdd,
  planResolveLegacy,
  planSetStatus,
  planUndo,
  planUpdate,
  refreshLines,
  writesRoutine,
  type RoutinePlan,
} from './rules/routine';

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
  /** The origin put into share links. Defaults to the page's own origin. */
  origin?: () => string;
  /** Gmail sign-in. Defaults to Google Identity Services with VITE_GOOGLE_CLIENT_ID. */
  gmailToken?: TokenSource;
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
export const newestDocumentFirst = newestFirst;

const STATUS_ORDER: readonly RoutineStatus[] = ['taking', 'uncertain', 'not_started', 'stopped'];
/** Taken first, then not confirmed, not started and stopped; by name within each. */
const routineOrder = (a: RoutineMedicine, b: RoutineMedicine) =>
  STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.productName.localeCompare(b.productName) || a.id.localeCompare(b.id);

const HEALTH_ORDER: readonly HealthEntryKind[] = ['allergy', 'condition', 'procedure', 'note'];
const healthOrder = (a: HealthEntry, b: HealthEntry) =>
  HEALTH_ORDER.indexOf(a.kind) - HEALTH_ORDER.indexOf(b.kind) || Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  const gmailTokens: TokenSource =
    options.gmailToken ?? createTokenSource({ clientId: (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID });

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

  const origin = options.origin ?? (() => (globalThis as { location?: { origin?: string } }).location?.origin ?? '');
  const ruleCtx = () => ({ now: nowIso(), newId });

  /** A share link as callers see it: the revoke token never leaves storage. */
  const publicLink = ({ id, profileId, snapshotId, url, createdAt, expiresAt, revoked }: ShareLink): ShareLink =>
    ({ id, profileId, snapshotId, url, createdAt, expiresAt, revoked });
  const newestLinkFirst = (a: ShareLink, b: ShareLink) =>
    Date.parse(b.createdAt ?? b.expiresAt) - Date.parse(a.createdAt ?? a.expiresAt) || a.id.localeCompare(b.id);

  async function livePassport(profileId: ID) {
    const profile = await need(repos.profiles.get(profileId), 'profile');
    return buildPassport({
      profile,
      today: todayFor(profileId, deviceToday()),
      prescribers: await repos.prescribers.byProfile(profileId),
      routine: await repos.routine.byProfile(profileId),
      events: await repos.routineEvents.byProfile(profileId),
      health: await repos.healthEntries.byProfile(profileId),
      documents: await repos.documents.byProfile(profileId),
      visit: await nextVisit(profileId),
    });
  }

  const visitOf = (id: ID) => need(repos.visits.get(id), 'visit');

  /**
   * Stores an original and its record together, before any reading (overview 9.1). An email
   * import also stores when the message arrived and which attachment it was, in the same batch.
   */
  async function storeDocument(
    profileId: ID,
    file: Blob,
    meta: { source: DocumentRecord['source']; title?: string },
    email?: { receivedAt: string; messageId: string; attachmentId: string },
  ): Promise<{ record: DocumentRecord; duplicate: DuplicateInfo | null }> {
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
        // The email's arrival is when it reached CareVault's inbox, never the clinical date.
        clinicalDate: null,
        dateSource: 'unknown',
        addedAt: nowIso(),
        receivedAt: email?.receivedAt ?? null,
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
      await repos.documents.put(record);
      await repos.files.put(record.id, blob);
      if (email) {
        await repos.gmailImports.put({ profileId, messageId: email.messageId, attachmentId: email.attachmentId, documentId: record.id, importedAt: record.addedAt });
      }
      const duplicate: DuplicateInfo | null = earlier
        ? { existingId: earlier.id, existingTitle: earlier.title, existingAddedAt: earlier.addedAt, exact: true }
        : null;
      return { record, duplicate };
    });
  }

  // Gmail: the token lives in memory only (see core/gmail/token.ts).
  let gmailConnectedOnce = false;
  const gmailToken = (): string => {
    try {
      return gmailTokens.token();
    } catch {
      throw new ServiceError('unknown', gmailConnectedOnce ? GMAIL_MESSAGES.expired : 'Connect Gmail first.');
    }
  };

  /** An import of this attachment for this profile whose record still exists. */
  async function importedRecord(profileId: ID, messageId: string, attachmentId: string): Promise<DocumentRecord | null> {
    const row = await repos.gmailImports.get(profileId, messageId, attachmentId);
    return row ? (await repos.documents.get(row.documentId)) ?? null : null;
  }
  const deviceToday = (): ISODate => {
    const d = clock();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** Stores a routine plan; bumps the revision once when the routine was written. Inside a batch. */
  async function applyPlan(profileId: ID, plan: RoutinePlan): Promise<number> {
    if (plan.deleteIds.length > 0) await repos.routine.bulkDelete(plan.deleteIds);
    if (plan.upserts.length > 0) await repos.routine.bulkPut(plan.upserts);
    if (plan.events.length > 0) await repos.routineEvents.bulkPut(plan.events);
    return writesRoutine(plan) ? repos.routineRevision.bump(profileId) : repos.routineRevision.get(profileId);
  }

  /** The first visit on or after the profile's today. */
  async function nextVisit(profileId: ID): Promise<Visit | null> {
    const today = todayFor(profileId, deviceToday());
    return (await repos.visits.byProfile(profileId)).find((v) => v.at.slice(0, 10) >= today) ?? null;
  }

  const storedProposalOf = async (documentId: ID) =>
    ((await repos.proposals.byDocument(documentId)) as StoredProposal[]).sort(byTime((p) => p.createdAt))[0] ?? null;

  /** The proposal for a document, recomputed against the current routine and lines. Inside a batch. */
  async function currentProposal(doc: DocumentRecord, lines: PrescriptionLine[], previous: StoredProposal | null): Promise<StoredProposal> {
    return buildProposal({
      proposalId: previous?.id ?? newId(),
      profileId: doc.profileId,
      documentId: doc.id,
      prescriberId: previous?.prescriberId ?? doc.prescriberId,
      lines,
      routine: await repos.routine.byProfile(doc.profileId),
      routineRevision: await repos.routineRevision.get(doc.profileId),
      now: nowIso(),
      previous,
    });
  }

  /** Stores the proposal (or removes it when nothing is left to ask) and returns what the caller sees. */
  async function keepProposal(next: StoredProposal, previous: StoredProposal | null) {
    if (hasNothingToAsk(next)) {
      if (previous) await repos.proposals.delete(previous.id);
      return null;
    }
    if (!previous || !sameProposal(previous, next)) await repos.proposals.put(next);
    return toPublic(next);
  }

  /** The verification gate for values taken from a document (a pack photo). */
  async function gateDocument(documentId: ID): Promise<void> {
    const evidence = await repos.fieldEvidence.byDocument(documentId);
    for (const lineIndex of new Set(evidence.map((e) => e.lineIndex).filter((i): i is number => i !== null))) {
      assertLineReviewable(evidence, lineIndex);
    }
    await repos.fieldEvidence.bulkPut(confirmExtracted(evidence, null, nowIso()));
  }

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
      add: guarded((profileId, file, meta) => storeDocument(profileId, file, meta)),

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
          // A correction made while checking the values also corrects the saved prescription lines.
          const lines = await repos.prescriptionLines.byDocument(id);
          const refreshed = refreshLines(lines, next);
          await repos.prescriptionLines.bulkPut(refreshed.filter((l, i) => !sameJson(l, lines[i])));
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
    prescriptions: {
      save: guarded(async (documentId, prescriberId, input) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(documentId), 'record');
          await prescriberOf(doc.profileId, prescriberId);
          if (new Set(input.map((l) => l.lineIndex)).size !== input.length) {
            throw new ServiceError('unknown', 'Each line of the prescription must have its own number.');
          }
          for (const line of input) {
            if (!line.productName.trim()) throw new ServiceError('unknown', 'Each line needs the medicine name.');
          }

          // The values the user saw in the line form and did not flag count as reviewed.
          const evidence = await repos.fieldEvidence.byDocument(documentId);
          const confirmed = input.flatMap((l) => confirmExtracted(evidence, l.lineIndex, nowIso()));
          await repos.fieldEvidence.bulkPut(confirmed);
          const reviewed = evidence.map((e) => confirmed.find((c) => c.id === e.id) ?? e);

          const existing = await repos.prescriptionLines.byDocument(documentId);
          const lines: PrescriptionLine[] = [...input]
            .sort((a, b) => a.lineIndex - b.lineIndex)
            .map((l) => {
              const line = {
                id: existing.find((e) => e.lineIndex === l.lineIndex)?.id ?? newId(),
                documentId,
                lineIndex: l.lineIndex,
                productName: l.productName.trim().replace(/\s+/g, ' '),
                ingredients: normalizeIngredients(l.ingredients),
                form: l.form,
                dosesPerDay: l.dosesPerDay,
                instruction: l.instruction.trim(),
                verified: false,
              };
              return { ...line, verified: isLineVerified(reviewed, line) };
            });
          if (!sameJson(lines, existing)) {
            await repos.prescriptionLines.deleteByDocument(documentId);
            await repos.prescriptionLines.bulkPut(lines);
          }
          const filedDoc = doc.prescriberId === prescriberId ? doc : await repos.documents.put({ ...doc, prescriberId });

          const previous = await storedProposalOf(documentId);
          // Saving again is a fresh look: a dismissed review opens again, for this prescriber.
          const base = previous ? { ...previous, prescriberId, status: previous.status === 'dismissed' ? ('open' as const) : previous.status } : null;
          const next = await currentProposal(filedDoc, lines, base);
          return { lines, proposal: await keepProposal(next, previous) };
        }),
      ),

      lines: guarded(async (documentId) => {
        await need(repos.documents.get(documentId), 'record');
        return repos.prescriptionLines.byDocument(documentId);
      }),
    },

    routine: {
      list: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return (await repos.routine.byProfile(profileId)).sort(routineOrder);
      }),

      get: guarded((id) => need(repos.routine.get(id), 'medicine')),

      // Newest first.
      history: guarded(async (medicineId) => {
        const events = await repos.routineEvents.byMedicine(medicineId);
        if (events.length === 0) await need(repos.routine.get(medicineId), 'medicine');
        return events.reverse();
      }),

      profileHistory: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return (await repos.routineEvents.byProfile(profileId)).reverse();
      }),

      revision: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return repos.routineRevision.get(profileId);
      }),

      add: guarded(async (profileId, input, opts) =>
        repos.transaction(async () => {
          await need(repos.profiles.get(profileId), 'profile');
          if (opts.documentId !== null) {
            const doc = await need(repos.documents.get(opts.documentId), 'record');
            if (doc.profileId !== profileId) throw notFound('record');
            await gateDocument(doc.id);
          }
          const plan = planAdd(profileId, input, opts, ruleCtx());
          await applyPlan(profileId, plan);
          return plan.upserts[0];
        }),
      ),

      update: guarded(async (id, patch) =>
        repos.transaction(async () => {
          const entry = await need(repos.routine.get(id), 'medicine');
          const plan = planUpdate(entry, patch, ruleCtx());
          await applyPlan(entry.profileId, plan);
          return plan.upserts[0] ?? entry;
        }),
      ),

      setStatus: guarded(async (id, status) =>
        repos.transaction(async () => {
          const entry = await need(repos.routine.get(id), 'medicine');
          const plan = planSetStatus(entry, status, ruleCtx());
          await applyPlan(entry.profileId, plan);
          return plan.upserts[0] ?? entry;
        }),
      ),

      undo: guarded(async (eventId) =>
        repos.transaction(async () => {
          const target = await need(repos.routineEvents.get(eventId), 'change');
          const events = await repos.routineEvents.byProfile(target.profileId);
          const entries = new Map((await repos.routine.byProfile(target.profileId)).map((m) => [m.id, m]));
          const plan = planUndo(target, events, entries, ruleCtx());
          await applyPlan(target.profileId, plan);

          // The review row whose decision made this change can be answered again.
          if (target.proposalId !== null) {
            const proposal = (await repos.proposals.get(target.proposalId)) as StoredProposal | undefined;
            const touched = new Set(plan.events.map((e) => e.medicineId));
            if (proposal?.memory) {
              const effects = { ...proposal.memory.effects };
              const reopened = proposal.rows.map((row) => {
                if (!(effects[row.id] ?? []).some((m) => touched.has(m))) return row;
                delete effects[row.id];
                return { ...row, decision: null, decidedAt: null };
              });
              const reopenedProposal: StoredProposal = { ...proposal, rows: reopened, status: 'open', memory: { ...proposal.memory, effects } };
              await repos.proposals.put(reopenedProposal);
            }
          }
          const restored = plan.upserts.find((m) => m.id === target.medicineId);
          return restored ?? target.after ?? target.before!;
        }),
      ),

      proposalFor: guarded(async (documentId) =>
        repos.transaction(async () => {
          const doc = await need(repos.documents.get(documentId), 'record');
          const lines = await repos.prescriptionLines.byDocument(documentId);
          const previous = await storedProposalOf(documentId);
          if (lines.length === 0) return previous ? toPublic(previous) : null;
          // Opening the review from the document page reopens a dismissed one.
          const base = previous && previous.status === 'dismissed' ? { ...previous, status: 'open' as const } : previous;
          const next = await currentProposal(doc, lines, base);
          return keepProposal(next, previous);
        }),
      ),

      decide: guarded(async (proposalId, decisions, expectedRevision) =>
        repos.transaction(async () => {
          const stored = (await need(repos.proposals.get(proposalId), 'review')) as StoredProposal;
          const doc = await need(repos.documents.get(stored.documentId), 'record');
          const lines = await repos.prescriptionLines.byDocument(doc.id);
          const routine = await repos.routine.byProfile(doc.profileId);
          const currentRevision = await repos.routineRevision.get(doc.profileId);
          const now = nowIso();
          const base = { proposalId, profileId: doc.profileId, documentId: doc.id, prescriberId: stored.prescriberId, lines, routineRevision: currentRevision, now };
          const fresh = buildProposal({ ...base, routine, previous: stored });

          const result = planDecisions(
            {
              proposal: fresh,
              decisions,
              expectedRevision,
              currentRevision,
              entries: new Map(routine.map((m) => [m.id, m])),
              nextVisit: await nextVisit(doc.profileId),
              rebuild: rebuildWith(base),
            },
            { now, newId },
          );
          const revision = await applyPlan(doc.profileId, result.plan);
          if (result.visit) await repos.visits.put(result.visit);
          const proposal: StoredProposal = {
            ...result.proposal,
            routineRevision: revision,
            status: result.proposal.status === 'reviewed' ? 'reviewed' : decisions.length > 0 ? 'open' : result.proposal.status,
          };
          if (!sameProposal(stored, proposal)) await repos.proposals.put(proposal);
          return { proposal: toPublic(proposal), changed: result.changed, questionsAdded: result.questionsAdded };
        }),
      ),

      dismiss: guarded(async (proposalId) =>
        repos.transaction(async () => {
          const stored = (await need(repos.proposals.get(proposalId), 'review')) as StoredProposal;
          const next: StoredProposal = { ...stored, status: 'dismissed' };
          if (stored.status !== 'dismissed') await repos.proposals.put(next);
          return toPublic(next);
        }),
      ),

      resolveLegacy: guarded(async (profileId, takingIds, notTakingIds) =>
        repos.transaction(async () => {
          await need(repos.profiles.get(profileId), 'profile');
          const plan = planResolveLegacy(await repos.routine.byProfile(profileId), takingIds, notTakingIds, ruleCtx());
          await applyPlan(profileId, plan);
          return plan.upserts;
        }),
      ),

      // The v1 totals, over the entries that may be taken: 'taking' and 'uncertain'.
      ingredientTotals: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        const counted = (await repos.routine.byProfile(profileId))
          .filter((m) => m.status === 'taking' || m.status === 'uncertain')
          .map((m) => ({ ...m, status: 'confirmed_current' }) as unknown as LegacyMedicine);
        return ingredientTotals(counted);
      }),
    },

    health: {
      list: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return (await repos.healthEntries.byProfile(profileId)).sort(healthOrder);
      }),

      add: guarded(async (profileId, input) =>
        repos.transaction(async () => {
          const profile = await need(repos.profiles.get(profileId), 'profile');
          const existing = await repos.healthEntries.byProfile(profileId);
          if (input.documentId) {
            const doc = await need(repos.documents.get(input.documentId), 'record');
            if (doc.profileId !== profileId) throw notFound('record');
          }
          const { add, removeIds } = planHealthAdd(existing, profile, input, ruleCtx());
          if (existing.some((h) => h.id === add.id)) return add;
          await repos.healthEntries.bulkDelete(removeIds);
          return repos.healthEntries.put(add);
        }),
      ),

      remove: guarded(async (id) => {
        await need(repos.healthEntries.get(id), 'entry');
        await repos.healthEntries.delete(id);
      }),
    },

    attention: {
      list: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return attentionItems({
          documents: await repos.documents.byProfile(profileId),
          evidence: await repos.fieldEvidence.byProfile(profileId),
          routine: await repos.routine.byProfile(profileId),
        });
      }),
    },

    records: {
      search: guarded(async (profileId, query) => {
        await need(repos.profiles.get(profileId), 'profile');
        return searchRecords(await repos.documents.byProfile(profileId), await repos.prescribers.byProfile(profileId), query ?? {});
      }),

      // Deterministic: fixed patterns, no model. The question and the records are only data.
      ask: guarded(async (profileId, question) => {
        await need(repos.profiles.get(profileId), 'profile');
        const documents = await repos.documents.byProfile(profileId);
        const prescribers = await repos.prescribers.byProfile(profileId);
        const routine = await repos.routine.byProfile(profileId);
        const lines = await repos.prescriptionLines.byDocuments(documents.map((d) => d.id));
        const parsed = parseQuestion(typeof question === 'string' ? question : '', {
          today: todayFor(profileId, deviceToday()),
          prescribers,
          facilities: documents.map((d) => d.facility).filter((f): f is string => !!f),
          medicineNames: [...routine, ...lines].flatMap((m) => [m.productName, ...m.ingredients.map((i) => i.name)]),
        });
        const empty = { query: null, documents: [], questions: [], medicines: [] };

        if (parsed.kind === 'not_understood') {
          return { ...empty, understood: false, kind: 'not_understood' as const, interpretedAs: '', text: `That question is not one CareVault understands. ${HINT}` };
        }
        if (parsed.kind === 'questions') {
          const answer = questionsAnswer(await nextVisit(profileId), prescribers);
          return { ...empty, understood: true, kind: 'questions' as const, interpretedAs: 'Questions saved for the next visit', questions: answer.questions, text: answer.text };
        }
        if (parsed.kind === 'routine') {
          const answer = routineAnswer(routine, parsed.medicine);
          const interpretedAs = parsed.medicine ? `Medicines with ${parsed.medicine} recorded as taken` : 'Medicines recorded as taken';
          return { ...empty, understood: true, kind: 'routine' as const, interpretedAs, medicines: answer.medicines, text: answer.text };
        }
        const medicine = parsed.medicine;
        const onlyIds = medicine
          ? new Set(lines.filter((l) => l.ingredients.some((i) => i.name === medicine) || normalizeQuestion(l.productName).split(' ').includes(medicine)).map((l) => l.documentId))
          : undefined;
        const hits = searchRecords(documents, prescribers, parsed.query, onlyIds);
        return {
          ...empty,
          understood: true,
          kind: 'documents' as const,
          interpretedAs: parsed.interpretedAs,
          query: parsed.query,
          documents: hits,
          text: documentsText(parsed, hits, prescribers),
        };
      }),
    },
    visits: {
      next: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return nextVisit(profileId);
      }),

      save: guarded(async (input) =>
        repos.transaction(async () => {
          await need(repos.profiles.get(input.profileId), 'profile');
          await prescriberOf(input.profileId, input.prescriberId);
          if (typeof input.at !== 'string' || Number.isNaN(Date.parse(input.at))) {
            throw new ServiceError('unknown', 'Please enter the date and time of the visit.');
          }
          if (input.id !== undefined) {
            const existing = await repos.visits.get(input.id);
            if (existing && existing.profileId !== input.profileId) throw notFound('visit');
          }
          const known = new Set((await repos.documents.byProfile(input.profileId)).map((d) => d.id));
          const seen = new Set<string>();
          const questions: Question[] = [];
          for (const q of input.questions ?? []) {
            const text = q.text.trim().replace(/\s+/g, ' ');
            if (!text || seen.has(text.toLowerCase())) continue;
            seen.add(text.toLowerCase());
            questions.push({ ...q, id: q.id || newId(), text });
          }
          return repos.visits.put({
            id: input.id ?? newId(),
            profileId: input.profileId,
            prescriberId: input.prescriberId,
            at: input.at,
            questions,
            sharedDocumentIds: [...new Set(input.sharedDocumentIds ?? [])].filter((id) => known.has(id)),
          });
        }),
      ),

      addQuestion: guarded(async (visitId, text, link) =>
        repos.transaction(async () => {
          const visit = await visitOf(visitId);
          const clean = (text ?? '').trim().replace(/\s+/g, ' ');
          if (!clean) throw new ServiceError('unknown', 'Please write the question.');
          if (link?.medicineId) {
            const entry = await repos.routine.get(link.medicineId);
            if (!entry || entry.profileId !== visit.profileId) throw notFound('medicine');
          }
          if (link?.documentId) {
            const doc = await repos.documents.get(link.documentId);
            if (!doc || doc.profileId !== visit.profileId) throw notFound('record');
          }
          // The same question twice is kept once.
          if (visit.questions.some((q) => q.text.toLowerCase() === clean.toLowerCase())) return visit;
          const question: Question = { id: newId(), text: clean, source: 'manual', medicineId: link?.medicineId ?? null, documentId: link?.documentId ?? null };
          return repos.visits.put({ ...visit, questions: [...visit.questions, question] });
        }),
      ),

      removeQuestion: guarded(async (visitId, questionId) =>
        repos.transaction(async () => {
          const visit = await visitOf(visitId);
          if (!visit.questions.some((q) => q.id === questionId)) return visit;
          return repos.visits.put({ ...visit, questions: visit.questions.filter((q) => q.id !== questionId) });
        }),
      ),

      setSharedDocuments: guarded(async (visitId, documentIds) =>
        repos.transaction(async () => {
          const visit = await visitOf(visitId);
          const known = new Set((await repos.documents.byProfile(visit.profileId)).map((d) => d.id));
          const unknown = documentIds.filter((id) => !known.has(id));
          if (unknown.length > 0) throw notFound('record');
          return repos.visits.put({ ...visit, sharedDocumentIds: [...new Set(documentIds)] });
        }),
      ),
    },

    passport: {
      live: guarded((profileId) => livePassport(profileId)),

      snapshot: guarded(async (profileId, reason) =>
        repos.transaction(async () => {
          if (!['manual', 'print', 'share'].includes(reason)) throw new ServiceError('unknown', 'Unknown reason for the snapshot.');
          const live = await livePassport(profileId);
          const [latest] = await repos.snapshots.byProfile(profileId);
          const { snapshot, created } = planSnapshot(live, latest ?? null, reason, ruleCtx());
          if (created) await repos.snapshots.put(snapshot);
          return snapshot;
        }),
      ),

      snapshots: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return repos.snapshots.byProfile(profileId);
      }),

      getSnapshot: guarded((id) => need(repos.snapshots.get(id), 'passport')),
    },

    sharing: {
      create: guarded(async (snapshotId, hours) => {
        const snapshot = await need(repos.snapshots.get(snapshotId), 'passport');
        // Between one hour and seven days. The server applies the same upper limit.
        if (!(typeof hours === 'number' && Number.isFinite(hours) && hours >= 1 && hours <= 24 * 7)) {
          throw new ServiceError('unknown', 'A link can last from 1 hour to 7 days.');
        }
        const expiresAt = new Date(clock().getTime() + hours * 3_600_000).toISOString();
        // Encrypting and uploading happen before the transaction.
        const share = await uploadSnapshot(snapshot, expiresAt, fetcher);
        const link: ShareLink = {
          id: share.id,
          profileId: snapshot.profileId,
          snapshotId: snapshot.id,
          url: `${origin()}/share/${share.id}#${share.key}`,
          createdAt: nowIso(),
          expiresAt: share.expiresAt,
          revoked: false,
        };
        await repos.shares.put({ ...link, revokeToken: share.revokeToken });
        return link;
      }),

      list: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        return (await repos.shares.byProfile(profileId)).map(publicLink).sort(newestLinkFirst);
      }),

      listUnowned: guarded(async () => (await repos.shares.unowned()).map(publicLink).sort(newestLinkFirst)),

      revoke: guarded(async (id) => {
        const share = await need(repos.shares.get(id), 'share link');
        if (share.revoked) return;
        await revokeLink(id, share.revokeToken, fetcher);
        await repos.shares.put({ ...share, revoked: true });
      }),

      open: guarded((id, key) => downloadSnapshot(id, key, fetcher)),
    },

    gmail: {
      connect: guarded(async () => {
        try {
          await gmailTokens.connect();
        } catch (error) {
          const message = error instanceof Error && error.message ? error.message : 'Gmail was not connected. Nothing was read.';
          throw new ServiceError(/not set up/.test(message) ? 'not_configured' : 'unknown', message.replace(/: VITE_GOOGLE_CLIENT_ID is missing\./, ' on this copy.'));
        }
        gmailConnectedOnce = true;
      }),

      findCandidates: guarded(async (profileId) => {
        await need(repos.profiles.get(profileId), 'profile');
        const candidates = await findGmailCandidates(gmailToken(), fetcher);
        const result: GmailCandidate[] = [];
        for (const c of candidates) {
          result.push({ ...c, alreadyImported: (await importedRecord(profileId, c.messageId, c.attachmentId)) !== null });
        }
        return result;
      }),

      importAttachment: guarded(async (profileId, messageId, attachmentId) => {
        await need(repos.profiles.get(profileId), 'profile');
        // The same attachment for the same profile stays one record.
        const existing = await importedRecord(profileId, messageId, attachmentId);
        if (existing) return { record: existing, duplicate: null };

        const { candidate, file } = await downloadAttachment(gmailToken(), messageId, attachmentId, fetcher);
        const title = candidate.attachmentName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || candidate.subject;
        const { record, duplicate } = await storeDocument(profileId, file, { source: 'email', title }, { receivedAt: candidate.receivedAt, messageId, attachmentId });

        // Then it is read like any other record. A failed reading keeps the record: it can be read again from its page.
        try {
          await services.reading.read(record.id, { allowCloud: false });
        } catch {
          // Nothing to undo: the original is stored.
        }
        return { record: await need(repos.documents.get(record.id), 'record'), duplicate };
      }),
    },

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
