// In-memory implementation of CareVaultServices for building the UI (UI spec section 1).
// - Starts from src/contract/fixtures/sampleCase.ts.
// - Waits 300 to 800 ms per call so loading states are visible.
// - Failure switch: localStorage.cvMockFail = 'reading' (or a comma list of method groups, or 'all')
//   makes those calls reject with ServiceError('network'). The extra value 'cloud_consent' makes
//   reading.read reject with 'cloud_consent_required' when allowCloud is false.
// - "Today" is fixed at SAMPLE_TODAY so the sample visit stays upcoming.
import type { CareVaultServices } from '../../contract/legacy/services';
import type * as T from '../../contract/legacy/types';
import { ServiceError } from '../../contract/legacy/types';
import { IDS, SAMPLE_TODAY } from '../../contract/legacy/fixtures/sampleCase';
import { emptyState, seedSample } from './state';
import type { MockState } from './state';
import {
  computeIngredientTotals,
  describeStrength,
  diffLines,
  isActive,
  sameMedicine,
  shortDate,
  strengthDiffers,
} from './rules';
import { placeholderPdf } from './placeholderPdf';

export interface MockOptions {
  /** Fixed delay, or a [min, max] range in ms. Default [300, 800]. Use 0 in tests. */
  delayMs?: number | [number, number];
  /** Start with the sample profile loaded. Default true. */
  seeded?: boolean;
  /** Overrides the failure switch (otherwise read from localStorage.cvMockFail). */
  fail?: () => string | null;
}

type Group =
  | 'profiles' | 'medicines' | 'reading' | 'documents' | 'prescriptions' | 'review'
  | 'visits' | 'sharing' | 'gmail' | 'backup' | 'settings';

const MOCK_TODAY = SAMPLE_TODAY;

const GMAIL_CANDIDATES: (T.GmailCandidate & { type: T.DocumentType; title: string })[] = [
  {
    messageId: 'mock-gmail-kidney-2026-11-13',
    subject: 'Your report is ready: Kidney function test',
    from: 'reports@greenleaf-diagnostics.example',
    date: '2026-11-13',
    attachmentName: 'kidney-function-test-2026-11-13.pdf',
    type: 'lab_report',
    title: 'Kidney function test',
  },
  {
    messageId: 'mock-gmail-xray-2026-11-02',
    subject: 'Chest X-ray report',
    from: 'imaging@riverside-clinic.example',
    date: '2026-11-02',
    attachmentName: 'chest-xray-2026-11-02.pdf',
    type: 'test',
    title: 'Chest X-ray report',
  },
];

function readFailSwitch(): string | null {
  try {
    return globalThis.localStorage?.getItem('cvMockFail') ?? null;
  } catch {
    return null;
  }
}

function newId(): T.ID {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): T.ISODateTime {
  return new Date().toISOString();
}

async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through to the non-cryptographic fallback (only used where Web Crypto is missing)
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + b, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.repeat(4);
}

/** Copies results so callers can never mutate mock state. Blobs are immutable and returned as is. */
function clone<V>(value: V): V {
  if (value === undefined || value === null || value instanceof Blob) return value;
  return structuredClone(value);
}

function notFound(what: string): never {
  throw new ServiceError('not_found', `${what} was not found.`);
}

export function createMockServices(options: MockOptions = {}): CareVaultServices {
  let state: MockState = emptyState();
  if (options.seeded ?? true) seedSample(state);

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

  const failSwitch = () => (options.fail ? options.fail() : readFailSwitch());
  const failing = (group: Group) => {
    const value = failSwitch();
    if (!value) return false;
    const parts = value.split(',').map((s) => s.trim());
    return parts.includes('all') || parts.includes(group);
  };

  /** Read call: delay, failure switch, cloned result. */
  async function read<R>(group: Group, fn: () => R | Promise<R>, factor = 1): Promise<R> {
    await delay(factor);
    if (failing(group)) throw new ServiceError('network', `Mock failure for ${group} (localStorage.cvMockFail).`);
    return clone(await fn());
  }

  /** Write call: as read, then notifies subscribers. */
  async function write<R>(group: Group, fn: () => R | Promise<R>, factor = 1): Promise<R> {
    const result = await read(group, fn, factor);
    notify();
    return result;
  }

  // ---------- lookups ----------

  const getMedicine = (id: T.ID) => state.medicines.find((m) => m.id === id) ?? notFound('Medicine');
  const getDocument = (id: T.ID) => state.documents.find((d) => d.id === id) ?? notFound('Document');
  const getVisit = (id: T.ID) => state.visits.find((v) => v.id === id) ?? notFound('Visit');
  const getProfile = (id: T.ID) => state.profiles.find((p) => p.id === id) ?? notFound('Profile');
  const prescriberName = (id: T.ID | null) => state.prescribers.find((p) => p.id === id)?.name ?? null;

  const addEvent = (m: T.Medicine, type: T.MedicationEventType, detail: string, documentId: T.ID | null = null) => {
    state.events.push({ id: newId(), profileId: m.profileId, medicineId: m.id, type, at: nowIso(), documentId, detail });
  };

  const setStatus = (m: T.Medicine, status: T.MedicineStatus) => {
    m.status = status;
    m.updatedAt = nowIso();
  };

  /** Prescription documents from one prescriber that have saved lines, oldest first. */
  const prescriptionsFrom = (profileId: T.ID, prescriberId: T.ID) =>
    state.documents
      .filter((d) => d.profileId === profileId && d.type === 'prescription' && d.prescriberId === prescriberId)
      .filter((d) => state.prescriptionLines.some((l) => l.documentId === d.id))
      .sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.addedAt.localeCompare(b.addedAt));

  const linesOf = (documentId: T.ID) => state.prescriptionLines.filter((l) => l.documentId === documentId);

  const nextVisit = (profileId: T.ID): T.Visit | null => {
    const from = `${MOCK_TODAY}T00:00:00`;
    return (
      state.visits
        .filter((v) => v.profileId === profileId && Date.parse(v.at) >= Date.parse(from))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null
    );
  };

  /** Opens one possible_duplicate review item per new set of medicines sharing an ingredient. */
  const refreshDuplicates = (profileId: T.ID) => {
    const active = state.medicines.filter((m) => m.profileId === profileId);
    for (const total of computeIngredientTotals(active)) {
      const ids = [...new Set(total.parts.map((p) => p.medicineId))].sort();
      const exists = state.reviewItems.some(
        (r) => r.profileId === profileId && r.kind === 'possible_duplicate' && [...r.medicineIds].sort().join() === ids.join(),
      );
      if (exists) continue;
      const names = total.parts.map((p) => p.productName);
      state.reviewItems.push({
        id: newId(),
        profileId,
        kind: 'possible_duplicate',
        title: `${names.length === 2 ? 'Two' : names.length} products contain ${total.ingredient}`,
        body: `${names.join(' and ')} contain the same ingredient. Please check with a pharmacist before they are used on the same day.`,
        medicineIds: ids,
        documentId: null,
        createdAt: nowIso(),
        resolvedAt: null,
        resolution: null,
      });
    }
  };

  /** Links review rows to the confirm_medicine item opened for the latest prescription. */
  const buildDiff = (profileId: T.ID, prescriberId: T.ID, latestDoc: T.DocumentRecord): T.PrescriptionDiff => {
    const docs = prescriptionsFrom(profileId, prescriberId);
    const index = docs.findIndex((d) => d.id === latestDoc.id);
    const previousDoc = index > 0 ? docs[index - 1] : null;
    const rows = diffLines(previousDoc ? linesOf(previousDoc.id) : null, linesOf(latestDoc.id));
    for (const row of rows) {
      if (row.kind !== 'review' || !row.previous) continue;
      const prev = row.previous;
      const item = state.reviewItems.find(
        (r) =>
          r.kind === 'confirm_medicine' &&
          r.documentId === latestDoc.id &&
          r.medicineIds.some((id) => {
            const m = state.medicines.find((x) => x.id === id);
            return m ? sameMedicine(m.ingredients, prev.ingredients) : false;
          }),
      );
      row.reviewItemId = item?.id ?? null;
    }
    return { prescriberId, previousDocumentId: previousDoc?.id ?? null, latestDocumentId: latestDoc.id, rows };
  };

  const latestDiffFor = (profileId: T.ID, prescriberId: T.ID): T.PrescriptionDiff | null => {
    const docs = prescriptionsFrom(profileId, prescriberId);
    const latest = docs[docs.length - 1];
    return latest ? buildDiff(profileId, prescriberId, latest) : null;
  };

  const activeMedicineLike = (profileId: T.ID, prescriberId: T.ID, ingredients: T.Ingredient[]) =>
    state.medicines.find(
      (m) => m.profileId === profileId && m.prescriberId === prescriberId && isActive(m) && sameMedicine(m.ingredients, ingredients),
    );

  const changeSummary = (profileId: T.ID): T.ChangeSummary | null => {
    const visit = nextVisit(profileId);
    if (!visit) return null;
    const diff = latestDiffFor(profileId, visit.prescriberId);
    if (!diff) return null;
    const latestDoc = getDocument(diff.latestDocumentId);
    const since = latestDoc.documentDate;
    const toConfirm = diff.rows.filter((row) => {
      if (row.kind !== 'review' || !row.previous) return false;
      const prev = row.previous;
      return state.medicines.some(
        (m) => m.profileId === profileId && m.status === 'needs_confirmation' && sameMedicine(m.ingredients, prev.ingredients),
      );
    }).length;
    return {
      since,
      added: diff.rows.filter((r) => r.kind === 'added').length,
      changed: diff.rows.filter((r) => r.kind === 'changed').length,
      toConfirm,
      newDocuments: state.documents.filter(
        (d) => d.profileId === profileId && d.id !== latestDoc.id && d.documentDate >= since,
      ).length,
    };
  };

  const buildPassport = (profileId: T.ID): T.Passport => {
    const profile = getProfile(profileId);
    const visit = nextVisit(profileId);
    const prescriber = visit ? state.prescribers.find((p) => p.id === visit.prescriberId) ?? null : null;
    const medicines = state.medicines.filter((m) => m.profileId === profileId);
    const diff = visit ? latestDiffFor(profileId, visit.prescriberId) : null;
    const latestDoc = diff ? getDocument(diff.latestDocumentId) : null;
    const when = latestDoc ? ` (${shortDate(latestDoc.documentDate)})` : '';

    const changes: T.Passport['changes'] = [];
    for (const row of diff?.rows ?? []) {
      if (row.kind === 'added' && row.latest) {
        changes.push({ kind: 'added', text: `${row.latest.productName}, ${row.latest.instruction}${when}` });
      } else if (row.kind === 'changed' && row.previous && row.latest) {
        const name = row.latest.ingredients.map((i) => i.name[0].toUpperCase() + i.name.slice(1)).join(' + ');
        const what = strengthDiffers(row.previous, row.latest)
          ? `from ${describeStrength(row.previous.ingredients)} to ${describeStrength(row.latest.ingredients)}`
          : `instructions changed to "${row.latest.instruction}"`;
        changes.push({ kind: 'changed', text: `${name} ${what}, ${row.latest.instruction}${when}` });
      } else if (row.kind === 'review' && row.previous && latestDoc) {
        const prev = row.previous;
        const stillUnconfirmed = medicines.some((m) => m.status === 'needs_confirmation' && sameMedicine(m.ingredients, prev.ingredients));
        if (stillUnconfirmed) {
          changes.push({ kind: 'unconfirmed', text: `${prev.productName} is not on the ${shortDate(latestDoc.documentDate)} prescription` });
        }
      }
    }

    const flags = state.reviewItems
      .filter((r) => r.profileId === profileId && r.kind === 'possible_duplicate' && (r.resolvedAt === null || r.resolution === 'ask_doctor'))
      .map((r) => {
        const meds = r.medicineIds.map((id) => medicines.find((m) => m.id === id)).filter((m): m is T.Medicine => !!m);
        const shared = meds.length
          ? meds[0].ingredients.map((i) => i.name).filter((n) => meds.every((m) => m.ingredients.some((i) => i.name === n)))
          : [];
        return `Possible duplicate ingredient (${shared.join(', ') || 'shared ingredient'}): ${meds.map((m) => m.productName).join(' and ')}.`;
      });

    return {
      patientName: profile.name,
      patientAge: profile.birthYear === null ? null : Number(MOCK_TODAY.slice(0, 4)) - profile.birthYear,
      preparedBy: `${profile.caregiverName}, ${profile.caregiverRelation}`,
      preparedOn: MOCK_TODAY,
      visitAt: visit?.at ?? null,
      prescriberName: prescriber?.name ?? null,
      prescriberSpecialty: prescriber?.specialty ?? null,
      currentMedicines: medicines
        .filter((m) => m.status === 'confirmed_current')
        .map((m) => ({ productName: m.productName, instruction: m.instruction, prescriberName: prescriberName(m.prescriberId) })),
      changesSince: diff?.previousDocumentId ? getDocument(diff.previousDocumentId).documentDate : null,
      changes,
      flags,
      documents: (visit?.sharedDocumentIds ?? [])
        .map((id) => state.documents.find((d) => d.id === id))
        .filter((d): d is T.DocumentRecord => !!d)
        .map((d) => ({ title: d.title, documentDate: d.documentDate })),
      questions: visit?.questions.map((q) => q.text) ?? [],
    };
  };

  const addQuestionToNextVisit = (profileId: T.ID, text: string) => {
    const visit = nextVisit(profileId);
    if (!visit || visit.questions.some((q) => q.text === text)) return;
    visit.questions.push({ id: newId(), text, source: 'review' });
  };

  // ---------- services ----------

  const services: CareVaultServices = {
    profiles: {
      list: () => read('profiles', () => state.profiles),
      create: (input) =>
        write('profiles', () => {
          const profile: T.Profile = { ...input, id: newId(), createdAt: nowIso() };
          state.profiles.push(profile);
          return profile;
        }),
      loadSampleProfile: () => write('profiles', () => seedSample(state)),
      prescribers: (profileId) => read('profiles', () => state.prescribers.filter((p) => p.profileId === profileId)),
    },

    medicines: {
      list: (profileId) => read('medicines', () => state.medicines.filter((m) => m.profileId === profileId)),
      get: (id) => read('medicines', () => getMedicine(id)),
      history: (medicineId) =>
        read('medicines', () => {
          getMedicine(medicineId);
          return state.events.filter((e) => e.medicineId === medicineId).sort((a, b) => a.at.localeCompare(b.at));
        }),
      addFromLine: (profileId, line, opts) =>
        write('medicines', () => {
          getProfile(profileId);
          const at = nowIso();
          const medicine: T.Medicine = {
            id: newId(),
            profileId,
            productName: line.productName,
            ingredients: line.ingredients,
            form: line.form,
            dosesPerDay: line.dosesPerDay,
            instruction: line.instruction,
            prescriberId: opts.documentId ? getDocument(opts.documentId).prescriberId : null,
            status: opts.origin === 'prescription' ? 'confirmed_current' : 'found_at_home',
            origin: opts.origin,
            sourceDocumentId: opts.documentId,
            fieldState: opts.origin === 'home_scan' ? 'extracted' : 'confirmed',
            replacedByMedicineId: null,
            createdAt: at,
            updatedAt: at,
          };
          state.medicines.push(medicine);
          addEvent(medicine, 'added', opts.origin === 'home_scan' ? 'Found at home (scanned pack)' : 'Added', opts.documentId);
          refreshDuplicates(profileId);
          return medicine;
        }),
      confirm: (id, patch) =>
        write('medicines', () => {
          const m = getMedicine(id);
          Object.assign(m, patch ?? {});
          m.fieldState = 'confirmed';
          setStatus(m, 'confirmed_current');
          addEvent(m, 'confirmed', 'Confirmed by the caregiver');
          refreshDuplicates(m.profileId);
          return m;
        }),
      setStatus: (id, status) =>
        write('medicines', () => {
          const m = getMedicine(id);
          if (m.status === status) return m;
          setStatus(m, status);
          if (status === 'stopped') addEvent(m, 'marked_stopped', 'Marked as stopped by the caregiver');
          if (status === 'confirmed_current') addEvent(m, 'confirmed', 'Confirmed by the caregiver');
          if (status === 'needs_confirmation') addEvent(m, 'flagged_for_review', 'Flagged for review');
          refreshDuplicates(m.profileId);
          return m;
        }),
      ingredientTotals: (profileId) =>
        read('medicines', () => computeIngredientTotals(state.medicines.filter((m) => m.profileId === profileId))),
    },

    reading: {
      read: (file, opts) =>
        read(
          'reading',
          (): T.ExtractionCandidate => {
            const fail = failSwitch() ?? '';
            if (fail.split(',').map((s) => s.trim()).includes('cloud_consent') && !opts.allowCloud) {
              throw new ServiceError('cloud_consent_required', 'This photo is hard to read on the device.');
            }
            const isPdf = file.type === 'application/pdf';
            if (!isPdf && !file.type.startsWith('image/')) {
              throw new ServiceError('unsupported_file', 'Please choose a photo or a PDF.');
            }
            const engine = opts.allowCloud && fail.includes('cloud_consent') ? 'cloud' : 'on_device';
            if (isPdf) {
              return {
                documentType: 'prescription',
                documentDate: MOCK_TODAY,
                prescriberName: 'Dr. Kavita Rao',
                engine,
                needsCloud: false,
                rawText: 'Dr. Kavita Rao, Cardiology\nAmlodipine 10 mg 1-0-0\nTelmisartan 40 mg 1-0-0\nRosuvastatin 10 mg 0-0-1',
                lines: [
                  { productName: 'Amlodipine 10 mg', ingredients: [{ name: 'amlodipine', strength: 10, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
                  { productName: 'Telmisartan 40 mg', ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
                  { productName: 'Rosuvastatin 10 mg', ingredients: [{ name: 'rosuvastatin', strength: 10, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, night', warnings: [] },
                ],
              };
            }
            return {
              documentType: 'other',
              documentDate: null,
              prescriberName: null,
              engine,
              needsCloud: false,
              rawText: 'DOLO 650\nParacetamol Tablets IP 650 mg\nEach uncoated tablet contains Paracetamol IP 650 mg',
              lines: [
                {
                  productName: 'Dolo 650',
                  ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }],
                  form: 'tablet',
                  dosesPerDay: null,
                  instruction: '',
                  warnings: ['How often it is taken was not found on the pack.'],
                },
              ],
            };
          },
          3,
        ),
    },

    documents: {
      list: (profileId) =>
        read('documents', () =>
          state.documents
            .filter((d) => d.profileId === profileId)
            .sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.addedAt.localeCompare(a.addedAt)),
        ),
      get: (id) => read('documents', () => getDocument(id)),
      add: (profileId, file, meta) =>
        write('documents', async () => {
          getProfile(profileId);
          const sha256 = await sha256Hex(file);
          const duplicate = state.documents.find((d) => d.profileId === profileId && d.sha256 === sha256);
          const record: T.DocumentRecord = {
            ...meta,
            id: newId(),
            profileId,
            state: 'pending_confirmation',
            starred: false,
            mimeType: file.type || 'application/octet-stream',
            sha256,
            addedAt: nowIso(),
          };
          state.documents.push(record);
          state.files.set(record.id, file);
          return { record, duplicateOf: duplicate?.id ?? null };
        }),
      confirm: (id) =>
        write('documents', () => {
          const d = getDocument(id);
          d.state = 'confirmed';
          return d;
        }),
      remove: (id) =>
        write('documents', () => {
          getDocument(id);
          state.documents = state.documents.filter((d) => d.id !== id);
          state.prescriptionLines = state.prescriptionLines.filter((l) => l.documentId !== id);
          state.files.delete(id);
          for (const v of state.visits) v.sharedDocumentIds = v.sharedDocumentIds.filter((x) => x !== id);
        }),
      star: (id, starred) =>
        write('documents', () => {
          const d = getDocument(id);
          d.starred = starred;
          return d;
        }),
      file: async (id) => {
        await delay();
        if (failing('documents')) throw new ServiceError('network', 'Mock failure for documents (localStorage.cvMockFail).');
        const d = getDocument(id);
        const stored = state.files.get(id);
        if (stored) return stored;
        const lines = linesOf(id).map((l) => `${l.productName} - ${l.instruction}`);
        return placeholderPdf([
          d.title,
          `${d.documentDate} - ${prescriberName(d.prescriberId) ?? 'CareVault sample document'}`,
          ...lines,
          'Synthetic sample document. Not a real medical record.',
        ]);
      },
      search: (profileId, text) =>
        read('documents', () => {
          const q = text.trim().toLowerCase();
          return state.documents
            .filter((d) => d.profileId === profileId)
            .filter((d) => !q || d.title.toLowerCase().includes(q) || d.type.replace(/_/g, ' ').includes(q))
            .sort((a, b) => b.documentDate.localeCompare(a.documentDate));
        }),
    },

    prescriptions: {
      apply: (profileId, documentId, prescriberId, lines) =>
        write('prescriptions', () => {
          const doc = getDocument(documentId);
          if (doc.prescriberId === null) doc.prescriberId = prescriberId;
          doc.type = 'prescription';
          // Applying the same prescription twice changes nothing the second time.
          if (linesOf(documentId).length > 0) return buildDiff(profileId, prescriberId, doc);

          for (const line of lines) {
            state.prescriptionLines.push({
              id: newId(),
              documentId,
              productName: line.productName,
              ingredients: line.ingredients,
              form: line.form,
              dosesPerDay: line.dosesPerDay,
              instruction: line.instruction,
              fieldState: 'confirmed',
            });
          }
          const diff = buildDiff(profileId, prescriberId, doc);
          const at = nowIso();
          const newMedicine = (line: T.PrescriptionLine): T.Medicine => {
            const m: T.Medicine = {
              id: newId(),
              profileId,
              productName: line.productName,
              ingredients: line.ingredients,
              form: line.form,
              dosesPerDay: line.dosesPerDay,
              instruction: line.instruction,
              prescriberId,
              status: 'confirmed_current',
              origin: 'prescription',
              sourceDocumentId: documentId,
              fieldState: 'confirmed',
              replacedByMedicineId: null,
              createdAt: at,
              updatedAt: at,
            };
            state.medicines.push(m);
            return m;
          };
          const when = shortDate(doc.documentDate);

          for (const row of diff.rows) {
            if (row.kind === 'added' && row.latest) {
              if (activeMedicineLike(profileId, prescriberId, row.latest.ingredients)) continue;
              const m = newMedicine(row.latest);
              addEvent(m, 'added', `Added from the prescription of ${prescriberName(prescriberId) ?? 'the prescriber'}, ${when}`, documentId);
            } else if (row.kind === 'changed' && row.previous && row.latest) {
              const old = activeMedicineLike(profileId, prescriberId, row.previous.ingredients);
              const m = newMedicine(row.latest);
              if (old) {
                setStatus(old, 'stopped');
                old.replacedByMedicineId = m.id;
                addEvent(old, 'replaced', `Replaced by ${m.productName}`, documentId);
              }
              addEvent(m, strengthDiffers(row.previous, row.latest) ? 'strength_changed' : 'instruction_changed', row.note, documentId);
            } else if (row.kind === 'review' && row.previous) {
              const old = activeMedicineLike(profileId, prescriberId, row.previous.ingredients);
              if (!old) continue;
              setStatus(old, 'needs_confirmation');
              addEvent(old, 'flagged_for_review', `Not on the prescription of ${prescriberName(prescriberId) ?? 'the prescriber'}, ${when}`, documentId);
              const item: T.ReviewItem = {
                id: newId(),
                profileId,
                kind: 'confirm_medicine',
                title: `Is ${old.productName} still being taken?`,
                body: `It is missing from ${prescriberName(prescriberId) ?? 'the prescriber'}'s prescription of ${when}.`,
                medicineIds: [old.id],
                documentId,
                createdAt: at,
                resolvedAt: null,
                resolution: null,
              };
              state.reviewItems.push(item);
              row.reviewItemId = item.id;
            }
          }
          refreshDuplicates(profileId);
          return diff;
        }),
      latestDiff: (profileId, prescriberId) => read('prescriptions', () => latestDiffFor(profileId, prescriberId)),
    },

    review: {
      listOpen: (profileId) =>
        read('review', () =>
          state.reviewItems
            .filter((r) => r.profileId === profileId && r.resolvedAt === null)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        ),
      resolve: (id, resolution, opts) =>
        write('review', () => {
          const item = state.reviewItems.find((r) => r.id === id) ?? notFound('Review item');
          if (item.resolvedAt !== null) return;
          const meds = item.medicineIds.map((mid) => state.medicines.find((m) => m.id === mid)).filter((m): m is T.Medicine => !!m);

          switch (resolution) {
            case 'still_taking':
              for (const m of meds) {
                setStatus(m, 'confirmed_current');
                m.fieldState = 'confirmed';
                addEvent(m, 'confirmed', 'Confirmed by the caregiver');
              }
              break;
            case 'stopped':
              for (const m of meds) {
                setStatus(m, 'stopped');
                addEvent(m, 'marked_stopped', 'Marked as stopped by the caregiver');
              }
              break;
            case 'ask_doctor':
              if (item.kind === 'possible_duplicate') {
                const names = meds.map((m) => m.productName).join(' and ');
                const shared = meds[0]?.ingredients.map((i) => i.name).find((n) => meds.every((m) => m.ingredients.some((i) => i.name === n)));
                addQuestionToNextVisit(item.profileId, `Can ${names} be used on the same day?${shared ? ` Both contain ${shared}.` : ''}`);
              } else {
                for (const m of meds) addQuestionToNextVisit(item.profileId, `Is ${m.productName} still needed? It is not on the latest prescription.`);
              }
              break;
            case 'only_one':
              for (const m of meds) {
                if (m.id === opts?.keepMedicineId) continue;
                setStatus(m, 'stopped');
                addEvent(m, 'marked_stopped', 'Marked as stopped: only one of these products is taken');
              }
              break;
            case 'added':
              if (item.documentId) getDocument(item.documentId).state = 'confirmed';
              break;
            case 'dismissed':
              if (item.kind === 'new_document' && item.documentId) {
                const doc = state.documents.find((d) => d.id === item.documentId);
                if (doc?.state === 'pending_confirmation') {
                  state.documents = state.documents.filter((d) => d.id !== doc.id);
                  state.files.delete(doc.id);
                }
              }
              break;
          }
          item.resolvedAt = nowIso();
          item.resolution = resolution;
        }),
    },

    visits: {
      next: (profileId) => read('visits', () => nextVisit(profileId)),
      save: (visit) =>
        write('visits', () => {
          const existing = visit.id ? state.visits.find((v) => v.id === visit.id) : undefined;
          if (existing) {
            Object.assign(existing, visit);
            return existing;
          }
          const created: T.Visit = { ...visit, id: visit.id ?? newId() };
          state.visits.push(created);
          return created;
        }),
      addQuestion: (visitId, text) =>
        write('visits', () => {
          const v = getVisit(visitId);
          const trimmed = text.trim();
          if (!trimmed) throw new ServiceError('unknown', 'Please type a question first.');
          v.questions.push({ id: newId(), text: trimmed, source: 'manual' });
          return v;
        }),
      removeQuestion: (visitId, questionId) =>
        write('visits', () => {
          const v = getVisit(visitId);
          v.questions = v.questions.filter((q) => q.id !== questionId);
          return v;
        }),
      setSharedDocuments: (visitId, documentIds) =>
        write('visits', () => {
          const v = getVisit(visitId);
          v.sharedDocumentIds = [...new Set(documentIds)];
          return v;
        }),
      changeSummary: (profileId) => read('visits', () => changeSummary(profileId)),
      buildPassport: (profileId) => read('visits', () => buildPassport(profileId)),
    },

    sharing: {
      create: (passport, hours) =>
        write('sharing', () => {
          const id = newId();
          const key = newId().replace(/-/g, '');
          const origin = globalThis.location?.origin ?? 'http://localhost';
          const link: T.ShareLink = {
            id,
            url: `${origin}/share/${id}#${key}`,
            expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
            revoked: false,
          };
          state.shares.push({ link, key, passport: clone(passport) });
          return link;
        }),
      list: () => read('sharing', () => state.shares.map((s) => s.link)),
      revoke: (id) =>
        write('sharing', () => {
          const share = state.shares.find((s) => s.link.id === id) ?? notFound('Share link');
          share.link.revoked = true;
        }),
      open: (id, key) =>
        read('sharing', () => {
          const share = state.shares.find((s) => s.link.id === id) ?? notFound('Shared passport');
          if (share.link.revoked) throw new ServiceError('revoked', 'This link was revoked.');
          if (Date.parse(share.link.expiresAt) < Date.now()) throw new ServiceError('expired', 'This link has expired.');
          if (share.key !== key) throw new ServiceError('unknown', 'This link could not be opened. The key does not match.');
          return share.passport;
        }),
    },

    gmail: {
      connect: () =>
        write('gmail', () => {
          state.gmail.connected = true;
        }),
      findCandidates: () =>
        read(
          'gmail',
          () => {
            if (!state.gmail.connected) throw new ServiceError('unknown', 'Connect Gmail first.');
            return GMAIL_CANDIDATES.filter((c) => !state.gmail.importedMessageIds.includes(c.messageId)).map(
              ({ messageId, subject, from, date, attachmentName }) => ({ messageId, subject, from, date, attachmentName }),
            );
          },
          2,
        ),
      importAttachment: (profileId, messageId) =>
        write('gmail', async () => {
          getProfile(profileId);
          if (!state.gmail.connected) throw new ServiceError('unknown', 'Connect Gmail first.');
          const c = GMAIL_CANDIDATES.find((x) => x.messageId === messageId) ?? notFound('Email attachment');
          const blob = placeholderPdf([c.title, c.date, `Imported from ${c.from}`, 'Synthetic sample document. Not a real medical record.']);
          const record: T.DocumentRecord = {
            id: newId(),
            profileId,
            type: c.type,
            title: c.title,
            documentDate: c.date,
            source: 'email',
            state: 'pending_confirmation',
            starred: false,
            prescriberId: null,
            mimeType: 'application/pdf',
            sha256: await sha256Hex(blob),
            addedAt: nowIso(),
          };
          state.documents.push(record);
          state.files.set(record.id, blob);
          state.gmail.importedMessageIds.push(messageId);
          state.reviewItems.push({
            id: newId(),
            profileId,
            kind: 'new_document',
            title: `Add this ${c.title} to the records?`,
            body: `A PDF arrived in the connected inbox on ${shortDate(c.date)}. Nothing is saved until you confirm.`,
            medicineIds: [],
            documentId: record.id,
            createdAt: nowIso(),
            resolvedAt: null,
            resolution: null,
          });
          return record;
        }, 2),
    },

    backup: {
      export: (passphrase) =>
        read('backup', async () => {
          const check = await sha256Hex(new Blob([`carevault-mock:${passphrase}`]));
          const { files, ...rest } = state;
          const payload = { format: 'carevault-mock-backup', version: 1, check, fileCount: files.size, data: rest };
          return new Blob([JSON.stringify(payload)], { type: 'application/json' });
        }),
      import: (file, passphrase) =>
        write('backup', async () => {
          let parsed: { format?: string; check?: string; data?: Omit<MockState, 'files'> };
          try {
            parsed = JSON.parse(await file.text());
          } catch {
            throw new ServiceError('unsupported_file', 'This is not a CareVault backup file.');
          }
          if (parsed.format !== 'carevault-mock-backup' || !parsed.data) {
            throw new ServiceError('unsupported_file', 'This is not a CareVault backup file.');
          }
          const check = await sha256Hex(new Blob([`carevault-mock:${passphrase}`]));
          if (check !== parsed.check) throw new ServiceError('bad_passphrase', 'The passphrase does not match this backup.');
          state = { ...emptyState(), ...parsed.data, files: new Map() };
        }),
    },

    settings: {
      get: () => read('settings', () => state.settings),
      setCloudReadingAllowed: (value) =>
        write('settings', () => {
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

/** Id of the sample profile, handy for screens and tests. */
export const SAMPLE_PROFILE_ID = IDS.profile;
