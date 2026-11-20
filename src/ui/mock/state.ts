// In-memory tables for the mock services, seeded from the frozen sample case.
import { IDS, sampleCase } from '../../contract/legacy/fixtures/sampleCase';
import type * as T from '../../contract/legacy/types';

export interface MockShare {
  link: T.ShareLink;
  key: string;
  passport: T.Passport;
}

export interface MockState {
  profiles: T.Profile[];
  prescribers: T.Prescriber[];
  medicines: T.Medicine[];
  events: T.MedicationEvent[];
  documents: T.DocumentRecord[];
  files: Map<T.ID, Blob>;
  prescriptionLines: T.PrescriptionLine[];
  reviewItems: T.ReviewItem[];
  visits: T.Visit[];
  shares: MockShare[];
  settings: { cloudReadingAllowed: boolean };
  gmail: { connected: boolean; importedMessageIds: string[] };
}

export function emptyState(): MockState {
  return {
    profiles: [],
    prescribers: [],
    medicines: [],
    events: [],
    documents: [],
    files: new Map(),
    prescriptionLines: [],
    reviewItems: [],
    visits: [],
    shares: [],
    settings: { cloudReadingAllowed: false },
    gmail: { connected: false, importedMessageIds: [] },
  };
}

/** Adds the sample case to the state. Idempotent: does nothing if the sample profile exists. */
export function seedSample(state: MockState): T.Profile {
  const existing = state.profiles.find((p) => p.id === IDS.profile);
  if (existing) return existing;
  const c = structuredClone({
    profile: sampleCase.profile,
    prescribers: sampleCase.prescribers,
    medicines: sampleCase.medicines,
    events: sampleCase.events,
    documents: sampleCase.documents,
    prescriptionLines: sampleCase.prescriptionLines,
    reviewItems: sampleCase.reviewItems,
    visit: sampleCase.visit,
  }) as {
    profile: T.Profile;
    prescribers: T.Prescriber[];
    medicines: T.Medicine[];
    events: T.MedicationEvent[];
    documents: T.DocumentRecord[];
    prescriptionLines: T.PrescriptionLine[];
    reviewItems: T.ReviewItem[];
    visit: T.Visit;
  };
  state.profiles.push(c.profile);
  state.prescribers.push(...c.prescribers);
  state.medicines.push(...c.medicines);
  state.events.push(...c.events);
  state.documents.push(...c.documents);
  state.prescriptionLines.push(...c.prescriptionLines);
  state.reviewItems.push(...c.reviewItems);
  state.visits.push(c.visit);
  return c.profile;
}
