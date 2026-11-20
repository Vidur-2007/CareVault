// PHASE 0 COMPATIBILITY MOCK for contract v2. Laptop B replaces this in UI step 1
// (docs/specs/02-ui.spec.md, section 5). It serves the v2 sample case in memory with simple,
// non-crashing behaviour. Where a method is not modelled yet, it says so with
// ServiceError('unknown', 'not built yet'): see TEMPORARY markers below.
import type { CareVaultServices } from '../../../contract/services';
import { sampleCase, SAMPLE_TODAY } from '../../../contract/fixtures/sampleCase';
import { todayFor } from '../../../contract/today';
import * as T from '../../../contract/types';

type State = {
  profiles: T.Profile[];
  prescribers: T.Prescriber[];
  documents: T.DocumentRecord[];
  files: Map<T.ID, Blob>;
  lines: T.PrescriptionLine[];
  evidence: T.FieldEvidence[];
  routine: T.RoutineMedicine[];
  events: T.RoutineEvent[];
  health: T.HealthEntry[];
  visits: T.Visit[];
  snapshots: T.PassportSnapshot[];
  shares: T.ShareLink[];
  cloudReadingAllowed: boolean;
};

const clone = <V>(value: V): V => structuredClone(value);
const notBuilt = (): never => {
  throw new T.ServiceError('unknown', 'not built yet');
};
const notFound = (what: string): never => {
  throw new T.ServiceError('not_found', `This ${what} is not on this device.`);
};

function emptyState(): State {
  return {
    profiles: [], prescribers: [], documents: [], files: new Map(), lines: [], evidence: [],
    routine: [], events: [], health: [], visits: [], snapshots: [], shares: [], cloudReadingAllowed: false,
  };
}

function seed(state: State): T.Profile {
  if (!state.profiles.some((p) => p.id === sampleCase.profiles[0].id)) {
    state.profiles.push(...clone(sampleCase.profiles));
    state.prescribers.push(...clone(sampleCase.prescribers));
    state.documents.push(...clone(sampleCase.documents));
    state.lines.push(...clone(sampleCase.prescriptionLines));
    state.evidence.push(...clone(sampleCase.fieldEvidence));
    state.routine.push(...clone(sampleCase.routine));
    state.events.push(...clone(sampleCase.routineEvents));
    state.health.push(...clone(sampleCase.healthEntries));
    state.visits.push(...clone(sampleCase.visits));
  }
  return clone(state.profiles.find((p) => p.id === sampleCase.profiles[0].id)!);
}

const deviceToday = () => new Date().toISOString().slice(0, 10);
const newestFirst = (a: T.DocumentRecord, b: T.DocumentRecord) => {
  if (a.clinicalDate && b.clinicalDate) return b.clinicalDate.localeCompare(a.clinicalDate);
  if (a.clinicalDate) return -1;
  if (b.clinicalDate) return 1;
  return b.addedAt.localeCompare(a.addedAt);
};

export interface MockV2Options {
  /** Start with the sample profiles loaded. Default true. */
  seeded?: boolean;
}

export function createMockServicesV2(options: MockV2Options = {}): CareVaultServices {
  const state = emptyState();
  if (options.seeded ?? true) seed(state);

  const listeners = new Set<() => void>();
  const notify = () => queueMicrotask(() => listeners.forEach((l) => l()));
  let counter = 0;
  const newId = () => `mock-${Date.now().toString(36)}-${(counter += 1)}`;
  const now = () => new Date().toISOString();

  const read = async <R>(fn: () => R): Promise<R> => clone(fn());
  const write = async <R>(fn: () => R): Promise<R> => {
    const result = clone(fn());
    notify();
    return result;
  };

  const getDoc = (id: T.ID) => state.documents.find((d) => d.id === id) ?? notFound('record');
  const getMed = (id: T.ID) => state.routine.find((m) => m.id === id) ?? notFound('medicine');
  const getVisit = (id: T.ID) => state.visits.find((v) => v.id === id) ?? notFound('visit');
  const getProfile = (id: T.ID) => state.profiles.find((p) => p.id === id) ?? notFound('profile');

  const totals = (profileId: T.ID): T.IngredientTotal[] => {
    const active = state.routine.filter((m) => m.profileId === profileId && (m.status === 'taking' || m.status === 'uncertain'));
    const groups = new Map<string, T.RoutineMedicine[]>();
    for (const m of active) for (const i of m.ingredients) groups.set(i.name, [...(groups.get(i.name) ?? []), m]);
    return [...groups.entries()]
      .filter(([, meds]) => meds.length >= 2)
      .map(([ingredient, meds]) => {
        const parts = meds.map((m) => {
          const i = m.ingredients.find((x) => x.name === ingredient)!;
          return { medicineId: m.id, productName: m.productName, perDay: m.dosesPerDay === null ? 0 : i.strength * m.dosesPerDay };
        });
        const complete = meds.every((m) => m.dosesPerDay !== null);
        return {
          ingredient, unit: meds[0].ingredients.find((x) => x.name === ingredient)!.unit,
          perDay: complete ? parts.reduce((s, p) => s + p.perDay, 0) : 0, parts, complete,
        };
      });
  };

  const livePassport = (profileId: T.ID): T.Passport => {
    const profile = getProfile(profileId);
    const today = todayFor(profileId, deviceToday());
    const visit = state.visits.find((v) => v.profileId === profileId && v.at.slice(0, 10) >= today) ?? null;
    const prescriber = (id: T.ID | null) => state.prescribers.find((p) => p.id === id) ?? null;
    const mine = state.routine.filter((m) => m.profileId === profileId);
    const health = state.health.filter((h) => h.profileId === profileId);
    const allergies = health.filter((h) => h.kind === 'allergy');
    return {
      profileId,
      patientName: profile.name,
      patientAge: profile.birthYear === null ? null : Number(today.slice(0, 4)) - profile.birthYear,
      emergencyContact: profile.emergencyContact,
      preparedBy: profile.caregiverName ? `${profile.caregiverName}, ${profile.caregiverRelation}` : profile.name,
      preparedOn: today,
      visit: visit ? { at: visit.at, prescriberName: prescriber(visit.prescriberId)?.name ?? '', specialty: prescriber(visit.prescriberId)?.specialty ?? '' } : null,
      currentMedicines: mine.filter((m) => m.status === 'taking').map((m) => ({
        productName: m.productName,
        ingredientsText: m.ingredients.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + '),
        instruction: m.instruction,
        prescriberName: prescriber(m.prescriberId)?.name ?? null,
        source: m.source,
        lastConfirmedOn: m.lastConfirmedAt?.slice(0, 10) ?? null,
      })), // TEMPORARY: order not yet the spec's order (laptop B step 1)
      unconfirmed: mine.filter((m) => m.status === 'uncertain' || m.legacyReviewPending)
        .map((m) => ({ productName: m.productName, reason: 'Current use not confirmed' })),
      allergies: allergies.some((a) => a.noneKnown)
        ? { state: 'none_known', items: [] }
        : allergies.length ? { state: 'listed', items: allergies.map((a) => a.text) } : { state: 'not_recorded', items: [] },
      conditions: health.filter((h) => h.kind === 'condition').map((h) => h.text),
      procedures: health.filter((h) => h.kind === 'procedure').map((h) => h.text),
      recentChanges: [], // TEMPORARY
      flags: totals(profileId).map((t) => `These medicines may contain the same active ingredient (${t.ingredient}). Please verify them with a pharmacist or prescriber.`),
      documents: (visit?.sharedDocumentIds ?? []).map((id) => getDoc(id)).map((d) => ({
        documentId: d.id, title: d.title, kind: d.kind, clinicalDate: d.clinicalDate, sha256: d.sha256, removedAt: null,
      })),
      questions: visit?.questions.map((q) => q.text) ?? [],
    };
  };

  const services: CareVaultServices = {
    profiles: {
      list: () => read(() => state.profiles),
      create: (input) => write(() => {
        const profile: T.Profile = { ...input, id: newId(), createdAt: now() };
        state.profiles.push(profile);
        return profile;
      }),
      update: (id, patch) => write(() => Object.assign(getProfile(id), patch)),
      loadSampleProfile: () => write(() => seed(state)),
      prescribers: (profileId) => read(() => state.prescribers.filter((p) => p.profileId === profileId)),
      addPrescriber: (profileId, input) => write(() => {
        const name = input.name.trim();
        if (!name) throw new T.ServiceError('unknown', 'Please enter the doctor\'s name.');
        const existing = state.prescribers.find((p) => p.profileId === profileId && p.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const created: T.Prescriber = { id: newId(), profileId, name, specialty: input.specialty.trim() };
        state.prescribers.push(created);
        return created;
      }),
    },

    documents: {
      add: (profileId, file, meta) => write(() => {
        getProfile(profileId);
        const record: T.DocumentRecord = {
          id: newId(), profileId, kind: 'other', title: meta.title ?? 'New record', clinicalDate: null, dateSource: 'unknown',
          addedAt: now(), receivedAt: null, source: meta.source, state: 'pending_review', starred: false, prescriberId: null,
          facility: null, tags: [], testNames: [], patientNameRead: null, patientMatch: 'not_found',
          mimeType: file.type || 'application/octet-stream', sha256: `mock-${file.size}-${file.type}`, // TEMPORARY: not a real hash
          pageCount: null, pagesRead: null,
        };
        const same = state.documents.find((d) => d.profileId === profileId && d.sha256 === record.sha256);
        state.documents.push(record);
        state.files.set(record.id, file);
        return {
          record,
          duplicate: same ? { existingId: same.id, existingTitle: same.title, existingAddedAt: same.addedAt, exact: true as const } : null,
        };
      }),
      get: (id) => read(() => getDoc(id)),
      list: (profileId) => read(() => state.documents.filter((d) => d.profileId === profileId).sort(newestFirst)),
      update: (id, patch) => write(() => {
        const d = getDoc(id);
        Object.assign(d, patch);
        if (patch.clinicalDate !== undefined) d.dateSource = patch.clinicalDate === null ? 'unknown' : 'user';
        return d;
      }),
      file: async (id) => {
        const d = clone(getDoc(id));
        const blob = state.files.get(id) ?? new Blob(['%PDF-1.4 mock sample document'], { type: 'application/pdf' });
        return { ...d, blob };
      },
      fileRecord: (id) => write(() => Object.assign(getDoc(id), { state: 'filed' as const })),
      remove: (id) => write(() => {
        getDoc(id);
        state.documents = state.documents.filter((d) => d.id !== id);
        state.files.delete(id);
        state.lines = state.lines.filter((l) => l.documentId !== id);
        state.evidence = state.evidence.filter((e) => e.documentId !== id);
        return { snapshotsMentioning: [], activeShares: [] }; // TEMPORARY
      }),
      assignProfile: (id, profileId) => write(() => Object.assign(getDoc(id), { profileId })),
      fields: (id) => read(() => state.evidence.filter((e) => e.documentId === id)),
      reviewFields: (id, decisions) => write(() => {
        for (const decision of decisions) {
          const e = state.evidence.find((x) => x.id === decision.evidenceId && x.documentId === id) ?? notFound('field');
          e.status = decision.action === 'confirm' ? 'user_confirmed' : decision.action === 'correct' ? 'user_corrected' : 'unknown';
          if (decision.action === 'correct') e.value = decision.value ?? e.value;
          e.reviewedAt = now();
        }
        return state.evidence.filter((e) => e.documentId === id);
      }),
    },

    reading: {
      // TEMPORARY: returns an empty candidate; laptop B models reading in UI step 1.
      read: (documentId) => read(() => {
        const d = getDoc(documentId);
        return {
          documentId, kind: d.kind, title: d.title, clinicalDate: d.clinicalDate, prescriberName: null, facility: d.facility,
          patientNameRead: d.patientNameRead, patientMatch: d.patientMatch, tags: d.tags, testNames: d.testNames,
          lines: [], fields: [], engine: 'on_device' as const, rawText: '', pageCount: d.pageCount, pagesRead: d.pagesRead,
          needsCloud: false,
        };
      }),
    },

    prescriptions: {
      save: (documentId, prescriberId, lines) => write(() => {
        Object.assign(getDoc(documentId), { kind: 'prescription' as const, prescriberId });
        state.lines = state.lines.filter((l) => l.documentId !== documentId);
        const saved = lines.map((l): T.PrescriptionLine => ({
          id: newId(), documentId, lineIndex: l.lineIndex, productName: l.productName, ingredients: l.ingredients,
          form: l.form, dosesPerDay: l.dosesPerDay, instruction: l.instruction, verified: true,
        }));
        state.lines.push(...saved);
        return { lines: saved, proposal: null }; // TEMPORARY: proposals arrive in UI step 1
      }),
      lines: (documentId) => read(() => state.lines.filter((l) => l.documentId === documentId).sort((a, b) => a.lineIndex - b.lineIndex)),
    },

    routine: {
      list: (profileId) => read(() => state.routine.filter((m) => m.profileId === profileId)),
      get: (id) => read(() => getMed(id)),
      history: (medicineId) => read(() => state.events.filter((e) => e.medicineId === medicineId)),
      profileHistory: (profileId) => read(() => state.events.filter((e) => e.profileId === profileId)),
      revision: async () => 0, // TEMPORARY
      add: (profileId, input, opts) => write(() => {
        getProfile(profileId);
        const at = now();
        const m: T.RoutineMedicine = {
          ...input, id: newId(), profileId, status: opts.status, source: opts.source, prescriberId: null,
          sourceDocumentId: opts.documentId, replacedByMedicineId: null, lastConfirmedAt: opts.status === 'taking' ? at : null,
          legacyStatus: null, legacyReviewPending: false, createdAt: at, updatedAt: at,
        };
        state.routine.push(m);
        state.events.push({
          id: newId(), profileId, medicineId: m.id, type: 'added', at, documentId: opts.documentId, proposalId: null,
          before: null, after: clone(m), undoesEventId: null, detail: 'Added',
        });
        return m;
      }),
      update: (id, patch) => write(() => Object.assign(getMed(id), patch, { updatedAt: now() })),
      setStatus: (id, status) => write(() => Object.assign(getMed(id), { status, updatedAt: now() })),
      undo: async () => notBuilt(),           // TEMPORARY
      proposalFor: async () => null,          // TEMPORARY
      decide: async () => notBuilt(),         // TEMPORARY
      dismiss: async () => notBuilt(),        // TEMPORARY
      resolveLegacy: (profileId, takingIds, notTakingIds) => write(() => {
        for (const m of state.routine.filter((x) => x.profileId === profileId)) {
          if (takingIds.includes(m.id)) Object.assign(m, { status: 'taking', legacyReviewPending: false });
          if (notTakingIds.includes(m.id)) Object.assign(m, { status: 'stopped', legacyReviewPending: false });
        }
        return state.routine.filter((x) => x.profileId === profileId);
      }),
      ingredientTotals: (profileId) => read(() => totals(profileId)),
    },

    health: {
      list: (profileId) => read(() => state.health.filter((h) => h.profileId === profileId)),
      add: (profileId, input) => write(() => {
        const entry: T.HealthEntry = { ...input, id: newId(), profileId, recordedAt: now() };
        if (entry.kind === 'allergy' && !entry.noneKnown) {
          state.health = state.health.filter((h) => !(h.profileId === profileId && h.kind === 'allergy' && h.noneKnown));
        }
        state.health.push(entry);
        return entry;
      }),
      remove: (id) => write(() => {
        state.health = state.health.filter((h) => h.id !== id);
      }),
    },

    attention: {
      list: (profileId) => read(() => totals(profileId).map((t): T.AttentionItem => ({
        id: `duplicate:${profileId}:${t.ingredient}`, kind: 'possible_duplicate_ingredient',
        title: `Possible duplicate ingredient: ${t.ingredient}`,
        body: 'These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.',
        documentId: null, medicineIds: t.parts.map((p) => p.medicineId),
      }))), // TEMPORARY: only duplicates are modelled yet
    },

    records: {
      search: (profileId, query) => read(() => {
        const text = query.text?.trim().toLowerCase();
        const hits = state.documents
          .filter((d) => d.profileId === profileId)
          .filter((d) => !query.kinds?.length || query.kinds.includes(d.kind))
          .filter((d) => !query.prescriberId || d.prescriberId === query.prescriberId)
          .filter((d) => !query.testName || d.testNames.some((t) => t.toLowerCase() === query.testName!.toLowerCase()))
          .filter((d) => !query.starredOnly || d.starred)
          .filter((d) => !text || [d.title, d.facility ?? '', ...d.tags, ...d.testNames].join(' ').toLowerCase().includes(text))
          .sort(newestFirst);
        if (query.sort === 'oldest') hits.reverse();
        return hits.slice(0, query.limit ?? hits.length).map((document) => ({ document, matchedOn: text ? ['text'] : [] }));
      }),
      // TEMPORARY: the deterministic question parser arrives in UI step 1.
      ask: async () => ({
        understood: false, kind: 'not_understood', interpretedAs: '', query: null, documents: [], questions: [], medicines: [],
        text: 'CareVault can search your records by test, doctor, place and date.',
      }),
    },

    visits: {
      next: (profileId) => read(() => {
        const today = todayFor(profileId, deviceToday());
        return state.visits.filter((v) => v.profileId === profileId && v.at.slice(0, 10) >= today).sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
      }),
      save: (visit) => write(() => {
        const existing = visit.id ? state.visits.find((v) => v.id === visit.id) : undefined;
        if (existing) return Object.assign(existing, visit);
        const created: T.Visit = { ...visit, id: visit.id ?? newId() };
        state.visits.push(created);
        return created;
      }),
      addQuestion: (visitId, text, link) => write(() => {
        const v = getVisit(visitId);
        if (!text.trim()) throw new T.ServiceError('unknown', 'Please type a question first.');
        v.questions.push({ id: newId(), text: text.trim(), source: 'manual', medicineId: link?.medicineId ?? null, documentId: link?.documentId ?? null });
        return v;
      }),
      removeQuestion: (visitId, questionId) => write(() => {
        const v = getVisit(visitId);
        v.questions = v.questions.filter((q) => q.id !== questionId);
        return v;
      }),
      setSharedDocuments: (visitId, documentIds) => write(() => Object.assign(getVisit(visitId), { sharedDocumentIds: [...new Set(documentIds)] })),
    },

    passport: {
      live: (profileId) => read(() => livePassport(profileId)),
      snapshot: (profileId, reason) => write(() => {
        const passport = livePassport(profileId);
        const latest = state.snapshots.filter((s) => s.profileId === profileId).sort((a, b) => b.revision - a.revision)[0];
        if (latest && JSON.stringify(latest.passport) === JSON.stringify(passport)) return latest;
        const snapshot: T.PassportSnapshot = { id: newId(), profileId, createdAt: now(), reason, passport, revision: (latest?.revision ?? 0) + 1 };
        state.snapshots.push(snapshot);
        return snapshot;
      }),
      snapshots: (profileId) => read(() => state.snapshots.filter((s) => s.profileId === profileId).sort((a, b) => b.revision - a.revision)),
      getSnapshot: (id) => read(() => state.snapshots.find((s) => s.id === id) ?? notFound('passport')),
    },

    sharing: {
      create: (snapshotId, hours) => write(() => {
        const snapshot = state.snapshots.find((s) => s.id === snapshotId) ?? notFound('passport');
        const id = newId();
        const link: T.ShareLink = {
          id, profileId: snapshot.profileId, snapshotId, url: `${globalThis.location?.origin ?? 'http://localhost'}/share/${id}#mock-key`,
          createdAt: now(), expiresAt: new Date(Date.now() + Math.min(Math.max(hours, 1), 168) * 3_600_000).toISOString(), revoked: false,
        };
        state.shares.push(link);
        return link;
      }),
      list: (profileId) => read(() => state.shares.filter((s) => s.profileId === profileId)),
      listUnowned: () => read(() => state.shares.filter((s) => s.profileId === null)),
      revoke: (id) => write(() => {
        Object.assign(state.shares.find((s) => s.id === id) ?? notFound('link'), { revoked: true });
      }),
      open: (id) => read(() => {
        const link = state.shares.find((s) => s.id === id) ?? notFound('link');
        if (link.revoked) throw new T.ServiceError('revoked', 'This link was revoked.');
        if (Date.parse(link.expiresAt) <= Date.now()) throw new T.ServiceError('expired', 'This link has expired.');
        return state.snapshots.find((s) => s.id === link.snapshotId) ?? notFound('passport');
      }),
    },

    gmail: {
      connect: async () => undefined,
      findCandidates: async () => [],         // TEMPORARY
      importAttachment: async () => notBuilt(), // TEMPORARY
    },

    backup: {
      export: async () => notBuilt(),          // TEMPORARY
      import: async () => notBuilt(),          // TEMPORARY
    },

    settings: {
      get: () => read(() => ({ cloudReadingAllowed: state.cloudReadingAllowed })),
      setCloudReadingAllowed: (value) => write(() => {
        state.cloudReadingAllowed = value;
      }),
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return services;
}

/** The sample calendar date, re-exported for screens that only need it in tests. */
export { SAMPLE_TODAY };
