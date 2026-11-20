// Loads the v2 sample case (both sample profiles) from the frozen fixtures.
import { sampleCase } from '../../../contract/fixtures/sampleCase';
import type { Profile } from '../../../contract/types';
import type { ReposV2 } from './repos';

/**
 * Writes each sample profile that is not on the device yet, in one batch, and returns the
 * first sample profile (Ramesh). Idempotent: a profile that already exists is left exactly
 * as it is, so the user's changes to it are kept.
 */
export async function loadSampleProfiles(repos: ReposV2): Promise<Profile> {
  return repos.transaction(async () => {
    const c = structuredClone({
      profiles: sampleCase.profiles,
      prescribers: sampleCase.prescribers,
      documents: sampleCase.documents,
      prescriptionLines: sampleCase.prescriptionLines,
      fieldEvidence: sampleCase.fieldEvidence,
      routine: sampleCase.routine,
      routineEvents: sampleCase.routineEvents,
      healthEntries: sampleCase.healthEntries,
      visits: sampleCase.visits,
    });

    for (const profile of c.profiles) {
      if (await repos.profiles.get(profile.id)) continue;
      const mine = <R extends { profileId: string | null }>(rows: readonly R[]) => rows.filter((r) => r.profileId === profile.id);
      const documentIds = new Set(mine(c.documents).map((d) => d.id));

      await repos.profiles.put(profile);
      await repos.prescribers.bulkPut(mine(c.prescribers));
      await repos.documents.bulkPut(mine(c.documents));
      await repos.prescriptionLines.bulkPut(c.prescriptionLines.filter((l) => documentIds.has(l.documentId)));
      await repos.fieldEvidence.bulkPut(mine(c.fieldEvidence));
      await repos.routine.bulkPut(mine(c.routine));
      await repos.routineEvents.bulkPut(mine(c.routineEvents));
      await repos.healthEntries.bulkPut(mine(c.healthEntries));
      await repos.visits.bulkPut(mine(c.visits));
    }
    return (await repos.profiles.get(c.profiles[0].id))!;
  });
}
