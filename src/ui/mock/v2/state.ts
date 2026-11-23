// In-memory tables for the v2 mock, seeded from the frozen v2 sample case.
import { IDS, sampleCase } from '../../../contract/fixtures/sampleCase';
import type * as T from '../../../contract/types';
import { wrapV1Passport } from './migrate';

/** A proposal with what the mock needs to recompute it. */
export interface StoredProposal {
  proposal: T.RoutineProposal;
  /** same_medicine / different_medicine answers: line index -> routine entry id, or 'new'. */
  overrides: Record<number, T.ID | 'new'>;
  /** The saved lines it was computed from, for "saving the same prescription twice". */
  linesKey: string;
}

export interface StoredShare {
  link: T.ShareLink;
  key: string;
  /** v1 links only: the bare v1 passport, wrapped (overview 9.7). */
  legacyPassport?: T.Passport;
}

export interface MockState {
  profiles: T.Profile[];
  prescribers: T.Prescriber[];
  documents: T.DocumentRecord[];
  files: Map<T.ID, Blob>;
  /** File names given at upload, used to pick a reading scenario. */
  fileNames: Map<T.ID, string>;
  lines: T.PrescriptionLine[];
  evidence: T.FieldEvidence[];
  /** The lines passed to prescriptions.save, before reviewed evidence is applied. */
  savedInput: Map<T.ID, T.ExtractedLine[]>;
  routine: T.RoutineMedicine[];
  events: T.RoutineEvent[];
  health: T.HealthEntry[];
  visits: T.Visit[];
  proposals: StoredProposal[];
  snapshots: T.PassportSnapshot[];
  shares: StoredShare[];
  /** Per-profile routine revision. */
  revisions: Map<T.ID, number>;
  settings: { cloudReadingAllowed: boolean };
  gmail: { connected: boolean; imported: Set<string> };
}

/** What the rule modules need besides the tables. */
export interface MockCtx {
  state: MockState;
  newId(): T.ID;
  now(): T.ISODateTime;
  /** todayFor(profileId, device date). */
  today(profileId: T.ID): T.ISODate;
}

export function emptyState(): MockState {
  return {
    profiles: [], prescribers: [], documents: [], files: new Map(), fileNames: new Map(), lines: [], evidence: [],
    savedInput: new Map(), routine: [], events: [], health: [], visits: [], proposals: [], snapshots: [], shares: [],
    revisions: new Map(), settings: { cloudReadingAllowed: false }, gmail: { connected: false, imported: new Set() },
  };
}

/** A v1 share link whose owner cannot be proven (overview 9.7), for Settings' "Older share links". Mock only. */
const LEGACY_SHARE_ID = 'mock-v1-share-older';

/** Seeds both sample profiles. Idempotent. Returns Ramesh, the primary sample profile. */
export function seedSample(state: MockState): T.Profile {
  if (!state.profiles.some((p) => p.id === IDS.ramesh)) {
    const c = structuredClone({
      profiles: sampleCase.profiles,
      prescribers: sampleCase.prescribers,
      documents: sampleCase.documents,
      lines: sampleCase.prescriptionLines,
      evidence: sampleCase.fieldEvidence,
      routine: sampleCase.routine,
      events: sampleCase.routineEvents,
      health: sampleCase.healthEntries,
      visits: [...sampleCase.visits],
    }) as {
      profiles: T.Profile[]; prescribers: T.Prescriber[]; documents: T.DocumentRecord[]; lines: T.PrescriptionLine[];
      evidence: T.FieldEvidence[]; routine: T.RoutineMedicine[]; events: T.RoutineEvent[]; health: T.HealthEntry[]; visits: T.Visit[];
    };
    state.profiles.push(...c.profiles);
    state.prescribers.push(...c.prescribers);
    state.documents.push(...c.documents);
    state.lines.push(...c.lines);
    state.evidence.push(...c.evidence);
    state.routine.push(...c.routine);
    state.events.push(...c.events);
    state.health.push(...c.health);
    state.visits.push(...c.visits);
    for (const p of c.profiles) state.revisions.set(p.id, 1);
  }
  if (!state.shares.some((s) => s.link.id === LEGACY_SHARE_ID)) {
    state.shares.push({
      key: 'mock-v1-key',
      link: {
        id: LEGACY_SHARE_ID, profileId: null, snapshotId: null,
        url: `${globalThis.location?.origin ?? 'http://localhost'}/share/${LEGACY_SHARE_ID}#mock-v1-key`,
        // v1 links stay revocable until they expire, so this one always has a few days left.
        createdAt: null, expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), revoked: false,
      },
      legacyPassport: wrapV1Passport({
        patientName: 'Ramesh Iyer', patientAge: 71, preparedBy: 'Anjali Iyer, daughter', preparedOn: '2026-11-10',
        visitAt: null, prescriberName: null, prescriberSpecialty: null,
        currentMedicines: [{ productName: 'Amlodipine 10 mg', instruction: '1 tablet, morning', prescriberName: 'Dr. Kavita Rao' }],
        changesSince: null, changes: [], flags: [], documents: [], questions: [],
      }),
    });
  }
  return state.profiles.find((p) => p.id === IDS.ramesh)!;
}
