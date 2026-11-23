// In-memory mock of contract v2 for building the UI (UI spec section 5).
// - Starts from src/contract/fixtures/sampleCase.ts and reproduces its `expected` values.
// - Waits 300 to 800 ms per call so loading states are visible.
// - Failure switch: localStorage.cvMockFail is a comma list. A method group name ('documents',
//   'reading', 'routine', ...) or 'all' makes those calls reject with ServiceError('network').
//   Special values:
//     'stale'          routine.decide and routine.undo reject with 'stale';
//     'locked'         reading.read of any PDF rejects with 'locked_pdf';
//     'cloud_consent'  reading.read rejects with 'cloud_consent_required' unless allowCloud
//                      (then it reads with the cloud engine, every field needing verification);
//     'verification'   every routine write that takes values from a document rejects with
//                      'verification_required'.
// - "Today" is todayFor(profileId, device date): the sample profiles stay on 14 Nov 2026.
// Reading scenarios are chosen by file name: see ./reading.ts.
import type { CareVaultServices } from '../../../contract/services';
import { SAMPLE_DOCUMENT_FILES, SAMPLE_TODAY } from '../../../contract/fixtures/sampleCase';
import { todayFor } from '../../../contract/today';
import * as T from '../../../contract/types';
import { placeholderPdf } from '../placeholderPdf';
import { migrateV1, type V1MockData } from './migrate';
import { attentionItems, getProfile, livePassport } from './passport';
import { GMAIL_ATTACHMENTS, attachmentDetails, readDocument } from './reading';
import {
  applyEvidence, changeStatus, computeRows, createEntry, decide, evidenceOf, getMedicine, ingredientTotals,
  nextVisit, noDifferences, rebuildLines, recordEvent, refreshProposal, revisionOf, undoEvent,
} from './routine';
import { ask, byClinicalDate, searchRecords } from './search';
import { emptyState, seedSample, type MockCtx, type MockState, type StoredProposal } from './state';
import { changeNote, deviceToday, longDate, norm, sha256Hex } from './text';

export interface MockV2Options {
  /** Fixed delay, or a [min, max] range in ms. Default [300, 800]. Use 0 in tests. */
  delayMs?: number | [number, number];
  /** Start with the sample profiles loaded. Default true. */
  seeded?: boolean;
  /** Overrides the failure switch (otherwise read from localStorage.cvMockFail). */
  fail?: () => string | null;
}

type Group =
  | 'profiles' | 'documents' | 'reading' | 'prescriptions' | 'routine' | 'health' | 'attention' | 'records'
  | 'visits' | 'passport' | 'sharing' | 'gmail' | 'backup' | 'settings';

type Special = 'stale' | 'locked' | 'cloud_consent' | 'verification';

function readFailSwitch(): string | null {
  try {
    return globalThis.localStorage?.getItem('cvMockFail') ?? null;
  } catch {
    return null;
  }
}

function randomId(): T.ID {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Copies results so callers can never change mock state. Blobs are immutable and returned as they are. */
function clone<V>(value: V): V {
  if (value === undefined || value === null || value instanceof Blob) return value;
  return structuredClone(value);
}

const notFound = (what: string): never => {
  throw new T.ServiceError('not_found', `This ${what} is not on this device.`);
};

const BACKUP_FORMAT = 'carevault-mock-backup';

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function createMockServicesV2(options: MockV2Options = {}): CareVaultServices {
  let state: MockState = emptyState();
  const ctx: MockCtx = {
    get state() { return state; },
    newId: randomId,
    now: () => new Date().toISOString(),
    today: (profileId) => todayFor(profileId, deviceToday()),
  };
  if (options.seeded ?? true) seedSample(state);

  // ---------- plumbing ----------

  const listeners = new Set<() => void>();
  let notifyScheduled = false;
  const notify = () => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      for (const l of [...listeners]) l();
    });
  };

  const delay = (factor = 1) => {
    const d = options.delayMs ?? [300, 800];
    const ms = Array.isArray(d) ? d[0] + Math.random() * (d[1] - d[0]) : d;
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => setTimeout(resolve, ms * factor));
  };

  const switches = () => (options.fail ? options.fail() : readFailSwitch())?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const failing = (group: Group) => {
    const s = switches();
    return s.includes('all') || s.includes(group);
  };
  const on = (special: Special) => switches().includes(special);

  async function read<R>(group: Group, fn: () => R | Promise<R>, factor = 1): Promise<R> {
    await delay(factor);
    if (failing(group)) throw new T.ServiceError('network', `Mock failure for ${group} (localStorage.cvMockFail).`);
    return clone(await fn());
  }

  async function write<R>(group: Group, fn: () => R | Promise<R>, factor = 1): Promise<R> {
    const result = await read(group, fn, factor);
    notify();
    return result;
  }

  // ---------- lookups ----------

  const getDoc = (id: T.ID) => state.documents.find((d) => d.id === id) ?? notFound('record');
  const getVisit = (id: T.ID) => state.visits.find((v) => v.id === id) ?? notFound('visit');
  const getSnapshot = (id: T.ID) => state.snapshots.find((s) => s.id === id) ?? notFound('passport');
  const proposalsOf = (documentId: T.ID) => state.proposals.filter((p) => p.proposal.documentId === documentId);
  const storedProposal = (id: T.ID) => state.proposals.find((p) => p.proposal.id === id) ?? notFound('review');

  /** Stores the original first, as pending_review, with its hash (9.1). */
  async function addDocument(
    profileId: T.ID, file: Blob, meta: { source: T.DocumentRecord['source']; title?: string; fileName?: string },
  ): Promise<{ record: T.DocumentRecord; duplicate: T.DuplicateInfo | null }> {
    getProfile(ctx, profileId);
    const sha256 = await sha256Hex(file);
    const fileName = meta.fileName ?? (file instanceof File ? file.name : '');
    const record: T.DocumentRecord = {
      id: ctx.newId(), profileId, kind: 'other',
      title: meta.title?.trim() || fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'New record',
      clinicalDate: null, dateSource: 'unknown', addedAt: ctx.now(), receivedAt: null, source: meta.source,
      state: 'pending_review', starred: false, prescriberId: null, facility: null, tags: [], testNames: [],
      patientNameRead: null, patientMatch: 'not_found', mimeType: file.type || 'application/octet-stream', sha256,
      pageCount: null, pagesRead: null,
    };
    const same = state.documents.find((d) => d.profileId === profileId && d.sha256 === sha256);
    state.documents.push(record);
    state.files.set(record.id, file);
    if (fileName) state.fileNames.set(record.id, fileName);
    return {
      record,
      duplicate: same ? { existingId: same.id, existingTitle: same.title, existingAddedAt: same.addedAt, exact: true } : null,
    };
  }

  /** The current proposal of a document, brought up to date; null when there is none. */
  function currentProposal(documentId: T.ID): StoredProposal | null {
    const stored = proposalsOf(documentId).at(-1);
    if (!stored) return null;
    refreshProposal(ctx, stored);
    return stored;
  }

  async function sampleFile(d: T.DocumentRecord): Promise<Blob> {
    const name = SAMPLE_DOCUMENT_FILES[d.id];
    if (name && typeof fetch === 'function') {
      try {
        const res = await fetch(`/sample-docs/${name}`);
        // The dev server answers missing files with index.html, so check the type.
        if (res.ok && (res.headers.get('content-type') ?? '').includes('pdf')) return await res.blob();
      } catch {
        // fall back to a generated placeholder
      }
    }
    return placeholderPdf([
      d.title,
      d.clinicalDate ? `Date: ${longDate(d.clinicalDate)}` : 'Date: not printed',
      d.facility ?? '',
      d.patientNameRead ? `Patient: ${d.patientNameRead}` : '',
      'Sample document (CareVault preview)',
    ].filter(Boolean));
  }

  // ---------- services ----------

  const services: CareVaultServices = {
    profiles: {
      list: () => read('profiles', () => state.profiles),
      create: (input) => write('profiles', () => {
        if (!input.name.trim()) throw new T.ServiceError('unknown', 'Please enter a name.');
        const profile: T.Profile = { ...input, name: input.name.trim(), id: ctx.newId(), createdAt: ctx.now() };
        state.profiles.push(profile);
        state.revisions.set(profile.id, 0);
        return profile;
      }),
      update: (id, patch) => write('profiles', () => Object.assign(getProfile(ctx, id), patch)),
      loadSampleProfile: () => write('profiles', () => seedSample(state)),
      prescribers: (profileId) => read('profiles', () => state.prescribers.filter((p) => p.profileId === profileId)),
      addPrescriber: (profileId, input) => write('profiles', () => {
        getProfile(ctx, profileId);
        const name = input.name.trim();
        if (!name) throw new T.ServiceError('unknown', 'Please enter the doctor\'s name.');
        const existing = state.prescribers.find((p) => p.profileId === profileId && norm(p.name) === norm(name));
        if (existing) return existing;
        const created: T.Prescriber = { id: ctx.newId(), profileId, name, specialty: input.specialty.trim() };
        state.prescribers.push(created);
        return created;
      }),
    },

    documents: {
      add: (profileId, file, meta) => write('documents', () => addDocument(profileId, file, meta)),
      get: (id) => read('documents', () => getDoc(id)),
      list: (profileId) => read('documents', () =>
        state.documents.filter((d) => d.profileId === profileId).sort(byClinicalDate('newest'))),
      update: (id, patch) => write('documents', () => {
        const d = getDoc(id);
        Object.assign(d, patch);
        if (patch.clinicalDate !== undefined) {
          d.dateSource = patch.clinicalDate === null ? 'unknown' : 'user';
          // Contract request v2-4 (provisional): a date typed by the user settles the date evidence.
          for (const e of evidenceOf(ctx, id).filter((x) => x.field === 'document_date')) {
            Object.assign(e, patch.clinicalDate === null
              ? { status: 'unknown', reviewedAt: ctx.now() }
              : { status: 'user_corrected', value: patch.clinicalDate, reviewedAt: ctx.now() });
          }
        }
        return d;
      }),
      file: async (id) => {
        await delay();
        if (failing('documents')) throw new T.ServiceError('network', 'Mock failure for documents (localStorage.cvMockFail).');
        const d = getDoc(id);
        const blob = state.files.get(id) ?? (await sampleFile(d));
        return { ...clone(d), blob };
      },
      fileRecord: (id) => write('documents', () => Object.assign(getDoc(id), { state: 'filed' as const })),
      remove: (id) => write('documents', () => {
        const d = getDoc(id);
        const at = ctx.now();
        const mentioning = state.snapshots.filter((s) => s.profileId === d.profileId && s.passport.documents.some((x) => x.documentId === id));
        for (const s of mentioning) {
          for (const x of s.passport.documents) if (x.documentId === id && x.removedAt === null) x.removedAt = at;
        }
        const ids = new Set(mentioning.map((s) => s.id));
        const activeShares = state.shares
          .filter((s) => s.link.snapshotId !== null && ids.has(s.link.snapshotId))
          .filter((s) => !s.link.revoked && Date.parse(s.link.expiresAt) > Date.now())
          .map((s) => s.link);
        state.documents = state.documents.filter((x) => x.id !== id);
        state.files.delete(id);
        state.fileNames.delete(id);
        state.savedInput.delete(id);
        state.lines = state.lines.filter((l) => l.documentId !== id);
        state.evidence = state.evidence.filter((e) => e.documentId !== id);
        state.proposals = state.proposals.filter((p) => p.proposal.documentId !== id);
        for (const v of state.visits) v.sharedDocumentIds = v.sharedDocumentIds.filter((x) => x !== id);
        return { snapshotsMentioning: mentioning.map((s) => s.id), activeShares };
      }),
      assignProfile: (id, profileId) => write('documents', () => {
        const d = getDoc(id);
        getProfile(ctx, profileId);
        if (d.profileId !== profileId) {
          d.profileId = profileId;
          d.prescriberId = null;
          for (const e of evidenceOf(ctx, id)) e.profileId = profileId;
        }
        // The user said whose record it is, so it no longer counts as a mismatch. Contract request
        // v2-4 (provisional): this also settles the patient name evidence.
        if (d.patientMatch === 'mismatch') d.patientMatch = 'match';
        for (const e of evidenceOf(ctx, id).filter((x) => x.field === 'patient_name')) {
          Object.assign(e, { status: 'user_confirmed', reviewedAt: ctx.now() });
        }
        return d;
      }),
      fields: (id) => read('documents', () => {
        getDoc(id);
        return evidenceOf(ctx, id);
      }),
      reviewFields: (id, decisions) => write('documents', () => {
        getDoc(id);
        const evidence = evidenceOf(ctx, id);
        const work = decisions.map((decision) => {
          const e = evidence.find((x) => x.id === decision.evidenceId) ?? notFound('value');
          if (decision.action === 'correct' && (decision.value === undefined || decision.value.trim() === '')) {
            throw new T.ServiceError('unknown', 'Please type the correct value.');
          }
          return { e, decision };
        });
        for (const { e, decision } of work) {
          e.status = decision.action === 'confirm' ? 'user_confirmed' : decision.action === 'correct' ? 'user_corrected' : 'unknown';
          if (decision.action === 'correct') e.value = decision.value!.trim();
          e.reviewedAt = ctx.now();
        }
        if (state.savedInput.has(id)) rebuildLines(ctx, id);
        return evidenceOf(ctx, id);
      }),
    },

    reading: {
      read: (documentId, opts) => write('reading', () => {
        const d = getDoc(documentId);
        if (on('cloud_consent') && !opts.allowCloud) {
          throw new T.ServiceError('cloud_consent_required', 'This page could not be read on the device. It can be read by the cloud reader if you allow it.');
        }
        const name = (state.fileNames.get(d.id) ?? '').toLowerCase();
        if (d.mimeType === 'application/pdf' && (on('locked') || name.includes('locked'))) {
          throw new T.ServiceError('locked_pdf', 'This PDF is password-protected. It is saved; fill in the details by hand.');
        }
        return readDocument(ctx, d, { allowCloud: opts.allowCloud, cloudForced: on('cloud_consent') && opts.allowCloud });
      }, 2),
    },

    prescriptions: {
      save: (documentId, prescriberId, lines) => write('prescriptions', () => {
        const d = getDoc(documentId);
        if (!state.prescribers.some((p) => p.id === prescriberId && p.profileId === d.profileId)) notFound('doctor');
        const input = clone(lines).sort((a, b) => a.lineIndex - b.lineIndex);
        const linesKey = JSON.stringify({ prescriberId, input: input.map((l) => ({ ...l, warnings: [] })) });
        Object.assign(d, { kind: 'prescription' as const, prescriberId });

        const existing = proposalsOf(documentId).at(-1);
        if (existing && existing.linesKey === linesKey) {
          // Saving the same lines twice returns the same proposal and writes nothing.
          refreshProposal(ctx, existing);
          return { lines: state.lines.filter((l) => l.documentId === documentId).sort((a, b) => a.lineIndex - b.lineIndex), proposal: existing.proposal };
        }
        // As in the core: values of the saved lines that were read cleanly ('extracted') and shown to
        // the user without a flag count as reviewed. Flagged values still need their check.
        const savedIndexes = new Set(input.map((l) => l.lineIndex));
        for (const e of evidenceOf(ctx, documentId)) {
          if (e.status === 'extracted' && e.lineIndex !== null && savedIndexes.has(e.lineIndex)) {
            Object.assign(e, { status: 'user_confirmed', reviewedAt: ctx.now() });
          }
        }
        state.savedInput.set(documentId, input);
        const saved = rebuildLines(ctx, documentId);
        const id = ctx.newId();
        const { rows, passiveIds } = computeRows(ctx, id, d.profileId, prescriberId, saved, {});
        state.proposals = state.proposals.filter((p) => p.proposal.documentId !== documentId);
        if (noDifferences(rows)) return { lines: saved, proposal: null };
        const proposal: T.RoutineProposal = {
          id, profileId: d.profileId, documentId, prescriberId, createdAt: ctx.now(),
          routineRevision: revisionOf(ctx, d.profileId), rows, passiveNotMentionedCount: passiveIds.length, status: 'open',
        };
        state.proposals.push({ proposal, overrides: {}, linesKey });
        return { lines: saved, proposal };
      }),
      lines: (documentId) => read('prescriptions', () => {
        getDoc(documentId);
        return state.lines.filter((l) => l.documentId === documentId).sort((a, b) => a.lineIndex - b.lineIndex);
      }),
    },

    routine: {
      list: (profileId) => read('routine', () => state.routine.filter((m) => m.profileId === profileId)),
      get: (id) => read('routine', () => getMedicine(ctx, id)),
      history: (medicineId) => read('routine', () => state.events.filter((e) => e.medicineId === medicineId)),
      profileHistory: (profileId) => read('routine', () => state.events.filter((e) => e.profileId === profileId)),
      revision: (profileId) => read('routine', () => revisionOf(ctx, profileId)),
      add: (profileId, input, opts) => write('routine', () => {
        getProfile(ctx, profileId);
        if (!input.productName.trim()) throw new T.ServiceError('unknown', 'Please enter the medicine name.');
        let values = input;
        if (opts.documentId !== null) {
          getDoc(opts.documentId);
          // The gate (9.2), as in the core: refused while a value of the document still needs
          // verification or was left unknown. Values read cleanly and shown count as reviewed.
          const evidence = evidenceOf(ctx, opts.documentId);
          if (on('verification') || evidence.some((e) => e.lineIndex !== null && (e.status === 'needs_verification' || e.status === 'unknown'))) {
            throw new T.ServiceError('verification_required', 'Check the highlighted value first.');
          }
          for (const e of evidence) if (e.status === 'extracted') Object.assign(e, { status: 'user_confirmed', reviewedAt: ctx.now() });
          // Contract request v2-1 (provisional): reviewed evidence wins over the values passed in.
          const applied = applyEvidence({ ...input, lineIndex: 0, warnings: [] }, evidence);
          values = { productName: applied.productName, ingredients: applied.ingredients, form: applied.form, dosesPerDay: applied.dosesPerDay, instruction: applied.instruction };
        }
        const m = createEntry(ctx, profileId, values, opts.status, opts.source, null, opts.documentId);
        recordEvent(ctx, m, 'added', opts.source === 'from_pack' ? 'Added from a photo of the pack' : 'Added', null, { documentId: opts.documentId });
        return m;
      }),
      update: (id, patch) => write('routine', () => {
        const m = getMedicine(ctx, id);
        const before = clone(m);
        Object.assign(m, clone(patch), { updatedAt: ctx.now() });
        if (JSON.stringify({ ...before, updatedAt: '' }) !== JSON.stringify({ ...m, updatedAt: '' })) {
          recordEvent(ctx, m, 'changed', changeNote(before, m), before);
        } else m.updatedAt = before.updatedAt;
        return m;
      }),
      setStatus: (id, status) => write('routine', () => {
        const m = getMedicine(ctx, id);
        changeStatus(ctx, m, status);
        return m;
      }),
      undo: (eventId) => write('routine', () => {
        if (on('stale')) throw new T.ServiceError('stale', 'A later change was made to this medicine. See the history.');
        return undoEvent(ctx, eventId);
      }),
      proposalFor: (documentId) => read('routine', () => {
        const d = getDoc(documentId);
        const stored = currentProposal(documentId);
        if (stored) {
          if (stored.proposal.status === 'dismissed') stored.proposal.status = 'open';
          return stored.proposal;
        }
        // As in the core: a prescription with lines but no stored review is compared now.
        const lines = state.lines.filter((l) => l.documentId === documentId);
        if (lines.length === 0) return null;
        const id = ctx.newId();
        const { rows, passiveIds } = computeRows(ctx, id, d.profileId, d.prescriberId, lines, {});
        if (noDifferences(rows)) return null;
        const proposal: T.RoutineProposal = {
          id, profileId: d.profileId, documentId, prescriberId: d.prescriberId, createdAt: ctx.now(),
          routineRevision: revisionOf(ctx, d.profileId), rows, passiveNotMentionedCount: passiveIds.length, status: 'open',
        };
        state.proposals.push({ proposal, overrides: {}, linesKey: '' });
        return proposal;
      }),
      decide: (proposalId, decisions, expectedRevision) => write('routine', () => {
        const stored = storedProposal(proposalId);
        const p = stored.proposal;
        if (on('stale') || expectedRevision !== revisionOf(ctx, p.profileId)) {
          refreshProposal(ctx, stored);
          throw new T.ServiceError('stale', 'The routine changed since this was prepared. It has been refreshed.');
        }
        refreshProposal(ctx, stored);
        return decide(ctx, stored, decisions, { gateAll: on('verification') });
      }),
      dismiss: (proposalId) => write('routine', () => {
        const p = storedProposal(proposalId).proposal;
        p.status = 'dismissed';
        return p;
      }),
      resolveLegacy: (profileId, takingIds, notTakingIds) => write('routine', () => {
        for (const m of state.routine.filter((x) => x.profileId === profileId && x.legacyReviewPending)) {
          if (takingIds.includes(m.id)) {
            const before = clone(m);
            Object.assign(m, { status: 'taking', legacyReviewPending: false, lastConfirmedAt: ctx.now(), updatedAt: ctx.now() });
            recordEvent(ctx, m, 'confirmed', 'Still taking, confirmed in the review of earlier medicines', before);
          } else if (notTakingIds.includes(m.id)) {
            const before = clone(m);
            Object.assign(m, { status: 'stopped', legacyReviewPending: false, updatedAt: ctx.now() });
            recordEvent(ctx, m, 'stopped', 'Not taking it, said in the review of earlier medicines', before);
          }
        }
        return state.routine.filter((x) => x.profileId === profileId);
      }),
      ingredientTotals: (profileId) => read('routine', () => ingredientTotals(ctx, profileId)),
    },

    health: {
      list: (profileId) => read('health', () => state.health.filter((h) => h.profileId === profileId)),
      add: (profileId, input) => write('health', () => {
        getProfile(ctx, profileId);
        if (!input.noneKnown && !input.text.trim()) throw new T.ServiceError('unknown', 'Please type the entry first.');
        const entry: T.HealthEntry = { ...input, text: input.noneKnown ? '' : input.text.trim(), id: ctx.newId(), profileId, recordedAt: ctx.now() };
        if (entry.kind === 'allergy') {
          // A real allergy replaces "No known allergies"; "No known allergies" is one entry only.
          state.health = state.health.filter((h) => !(h.profileId === profileId && h.kind === 'allergy' && h.noneKnown));
          if (entry.noneKnown && state.health.some((h) => h.profileId === profileId && h.kind === 'allergy')) {
            throw new T.ServiceError('unknown', 'Remove the listed allergies first.');
          }
        }
        state.health.push(entry);
        return entry;
      }),
      remove: (id) => write('health', () => {
        if (!state.health.some((h) => h.id === id)) notFound('entry');
        state.health = state.health.filter((h) => h.id !== id);
      }),
    },

    attention: {
      list: (profileId) => read('attention', () => attentionItems(ctx, profileId)),
    },

    records: {
      search: (profileId, query) => read('records', () => searchRecords(ctx, profileId, query)),
      ask: (profileId, question) => read('records', () => ask(ctx, profileId, question)),
    },

    visits: {
      next: (profileId) => read('visits', () => nextVisit(ctx, profileId)),
      save: (visit) => write('visits', () => {
        getProfile(ctx, visit.profileId);
        const existing = visit.id ? state.visits.find((v) => v.id === visit.id) : undefined;
        if (existing) return Object.assign(existing, clone(visit));
        const created: T.Visit = { ...clone(visit), id: visit.id ?? ctx.newId() };
        state.visits.push(created);
        return created;
      }),
      addQuestion: (visitId, text, link) => write('visits', () => {
        const v = getVisit(visitId);
        if (!text.trim()) throw new T.ServiceError('unknown', 'Please type a question first.');
        v.questions.push({ id: ctx.newId(), text: text.trim(), source: 'manual', medicineId: link?.medicineId ?? null, documentId: link?.documentId ?? null });
        return v;
      }),
      removeQuestion: (visitId, questionId) => write('visits', () => {
        const v = getVisit(visitId);
        v.questions = v.questions.filter((q) => q.id !== questionId);
        return v;
      }),
      setSharedDocuments: (visitId, documentIds) => write('visits', () => {
        const v = getVisit(visitId);
        v.sharedDocumentIds = [...new Set(documentIds)].filter((id) => state.documents.some((d) => d.id === id && d.profileId === v.profileId));
        return v;
      }),
    },

    passport: {
      live: (profileId) => read('passport', () => livePassport(ctx, profileId)),
      snapshot: (profileId, reason) => write('passport', () => {
        const passport = livePassport(ctx, profileId);
        const latest = state.snapshots.filter((s) => s.profileId === profileId).sort((a, b) => b.revision - a.revision)[0];
        if (latest && JSON.stringify(latest.passport) === JSON.stringify(passport)) return latest;
        const snapshot: T.PassportSnapshot = {
          id: ctx.newId(), profileId, createdAt: ctx.now(), reason, passport, revision: (latest?.revision ?? 0) + 1,
        };
        state.snapshots.push(snapshot);
        return snapshot;
      }),
      snapshots: (profileId) => read('passport', () =>
        state.snapshots.filter((s) => s.profileId === profileId).sort((a, b) => b.revision - a.revision)),
      getSnapshot: (id) => read('passport', () => getSnapshot(id)),
    },

    sharing: {
      create: (snapshotId, hours) => write('sharing', () => {
        const snapshot = getSnapshot(snapshotId);
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
          throw new T.ServiceError('unknown', 'A link can last between 1 hour and 7 days.');
        }
        const id = ctx.newId();
        const key = ctx.newId().replace(/-/g, '');
        const link: T.ShareLink = {
          id, profileId: snapshot.profileId, snapshotId,
          url: `${globalThis.location?.origin ?? 'http://localhost'}/share/${id}#${key}`,
          createdAt: ctx.now(), expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(), revoked: false,
        };
        state.shares.push({ link, key });
        return link;
      }),
      list: (profileId) => read('sharing', () => state.shares.filter((s) => s.link.profileId === profileId).map((s) => s.link)),
      listUnowned: () => read('sharing', () => state.shares.filter((s) => s.link.profileId === null).map((s) => s.link)),
      revoke: (id) => write('sharing', () => {
        const share = state.shares.find((s) => s.link.id === id) ?? notFound('link');
        share.link.revoked = true;
      }),
      open: (id, key) => read('sharing', () => {
        const share = state.shares.find((s) => s.link.id === id);
        if (!share || share.key !== key) throw new T.ServiceError('not_found', 'This link is not valid. Ask for a new one.');
        if (share.link.revoked) throw new T.ServiceError('revoked', 'This link was turned off by the person who shared it.');
        if (Date.parse(share.link.expiresAt) <= Date.now()) throw new T.ServiceError('expired', 'This link has expired.');
        if (share.link.snapshotId === null) {
          if (!share.legacyPassport) throw new T.ServiceError('not_found', 'This link is not valid. Ask for a new one.');
          return {
            id: `v1-${share.link.id}`, profileId: '', createdAt: share.link.createdAt ?? share.legacyPassport.preparedOn,
            reason: 'share' as const, passport: share.legacyPassport, revision: 0,
          };
        }
        return getSnapshot(share.link.snapshotId);
      }),
    },

    gmail: {
      connect: () => write('gmail', () => {
        state.gmail.connected = true;
      }),
      findCandidates: (profileId) => read('gmail', () => {
        getProfile(ctx, profileId);
        if (!state.gmail.connected) throw new T.ServiceError('not_configured', 'Connect Gmail first.');
        return GMAIL_ATTACHMENTS.map((a) => ({
          ...a.candidate,
          alreadyImported: state.gmail.imported.has(`${profileId}:${a.candidate.messageId}:${a.candidate.attachmentId}`),
        }));
      }),
      importAttachment: (profileId, messageId, attachmentId) => write('gmail', async () => {
        const profile = getProfile(ctx, profileId);
        if (!state.gmail.connected) throw new T.ServiceError('not_configured', 'Connect Gmail first.');
        const a = GMAIL_ATTACHMENTS.find((x) => x.candidate.messageId === messageId && x.candidate.attachmentId === attachmentId)
          ?? notFound('email attachment');
        const details = attachmentDetails(a, profile.name);
        const file = placeholderPdf([
          details.title, `Patient: ${details.patientNameRead}`,
          details.clinicalDate ? `Date: ${longDate(details.clinicalDate)}` : 'Date: not printed', details.facility,
        ]);
        const result = await addDocument(profileId, file, { source: 'email', title: details.title, fileName: a.candidate.attachmentName });
        Object.assign(result.record, {
          kind: details.kind, tags: details.tags, testNames: details.testNames, facility: details.facility,
          receivedAt: a.candidate.receivedAt, patientNameRead: details.patientNameRead, patientMatch: details.patientMatch,
          pageCount: 1, pagesRead: 1,
          // The date printed on the report; the receipt time never becomes the clinical date (9.1).
          clinicalDate: details.clinicalDate, dateSource: details.clinicalDate ? 'document' : 'unknown',
        } satisfies Partial<T.DocumentRecord>);
        state.gmail.imported.add(`${profileId}:${messageId}:${attachmentId}`);
        return result;
      }),
    },

    backup: {
      export: (passphrase) => read('backup', async () => {
        if (passphrase.length < 8) throw new T.ServiceError('bad_passphrase', 'Use a passphrase of at least 8 characters.');
        const check = await sha256Hex(new Blob([`carevault-mock:${passphrase}`]));
        const files: Record<string, { type: string; data: string }> = {};
        for (const [id, blob] of state.files) files[id] = { type: blob.type, data: await toBase64(blob) };
        const data = {
          ...state, files: undefined, fileNames: [...state.fileNames], savedInput: [...state.savedInput],
          revisions: [...state.revisions], gmail: { connected: state.gmail.connected, imported: [...state.gmail.imported] },
        };
        const payload = { format: BACKUP_FORMAT, version: 2, check, data, files };
        return new Blob([JSON.stringify(payload)], { type: 'application/json' });
      }),
      import: (file, passphrase) => write('backup', async () => {
        let parsed: { format?: string; version?: number; check?: string; data?: Record<string, unknown>; files?: Record<string, { type: string; data: string }> };
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new T.ServiceError('unsupported_file', 'This is not a CareVault backup file.');
        }
        if (parsed.format !== BACKUP_FORMAT || !parsed.data || (parsed.version !== 1 && parsed.version !== 2)) {
          throw new T.ServiceError('unsupported_file', 'This is not a CareVault backup file.');
        }
        const check = await sha256Hex(new Blob([`carevault-mock:${passphrase}`]));
        if (check !== parsed.check) throw new T.ServiceError('bad_passphrase', 'The passphrase does not match this backup.');
        const next = emptyState();
        if (parsed.version === 1) {
          // A v1 backup is mapped as the migration does (9.9). The v1 mock kept no file contents.
          migrateV1(next, parsed.data as unknown as V1MockData, ctx.now(), ctx.newId);
        } else {
          const d = parsed.data as unknown as Omit<MockState, 'files' | 'fileNames' | 'savedInput' | 'revisions' | 'gmail'> & {
            fileNames: [string, string][]; savedInput: [string, T.ExtractedLine[]][]; revisions: [string, number][];
            gmail: { connected: boolean; imported: string[] };
          };
          Object.assign(next, d, {
            fileNames: new Map(d.fileNames), savedInput: new Map(d.savedInput), revisions: new Map(d.revisions),
            gmail: { connected: d.gmail.connected, imported: new Set(d.gmail.imported) },
          });
          for (const [id, f] of Object.entries(parsed.files ?? {})) next.files.set(id, fromBase64(f.data, f.type));
        }
        state = next;
      }, 2),
    },

    settings: {
      get: () => read('settings', () => state.settings),
      setCloudReadingAllowed: (value) => write('settings', () => {
        state.settings.cloudReadingAllowed = value;
      }),
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return services;
}

/** The sample calendar date, re-exported for screens that only need it in tests. */
export { SAMPLE_TODAY };
