// Loads the demo case from the frozen fixtures into the local database.
import { IDS, sampleCase } from '../../contract/fixtures/sampleCase';
import type { Profile } from '../../contract/types';
import type { Repos } from './repos';

/**
 * Writes the sample case in one batch and returns its profile.
 *
 * Idempotent: if the sample profile is already there, nothing is written, so anything the
 * caregiver has changed in it since (answered review items, added medicines) is kept.
 */
export async function loadSampleProfile(repos: Repos): Promise<Profile> {
  return repos.transaction(async () => {
    const existing = await repos.profiles.get(IDS.profile);
    if (existing) return existing;

    // Clone so nothing stored can alias the frozen fixture objects.
    const c = structuredClone({
      profile: sampleCase.profile,
      prescribers: sampleCase.prescribers,
      medicines: sampleCase.medicines,
      events: sampleCase.events,
      documents: sampleCase.documents,
      prescriptionLines: sampleCase.prescriptionLines,
      reviewItems: sampleCase.reviewItems,
      visit: sampleCase.visit,
    });

    await repos.profiles.put(c.profile);
    await repos.prescribers.bulkPut(c.prescribers);
    await repos.medicines.bulkPut(c.medicines);
    await repos.events.bulkPut(c.events);
    await repos.documents.bulkPut(c.documents);
    await repos.prescriptionLines.bulkPut(c.prescriptionLines);
    await repos.reviewItems.bulkPut(c.reviewItems);
    await repos.visits.put(c.visit);
    return c.profile;
  });
}
