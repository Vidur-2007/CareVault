// The bridge between the database and the rules: load one profile's state, and store
// the plan the rules return.
import { ServiceError, type ID } from '../contract/legacy/types';
import type { Repos } from './db/repos';
import { applyPlan, type RulesState, type WritePlan } from './rules/types';

/** Everything the rules need about one profile. Rejects with `not_found` if it is gone. */
export async function loadState(repos: Repos, profileId: ID): Promise<RulesState> {
  const profile = await repos.profiles.get(profileId);
  if (!profile) throw new ServiceError('not_found', 'This profile is not on this device.');
  const [prescribers, medicines, events, documents, reviewItems, visits] = await Promise.all([
    repos.prescribers.byProfile(profileId),
    repos.medicines.byProfile(profileId),
    repos.events.byProfile(profileId),
    repos.documents.byProfile(profileId),
    repos.reviewItems.byProfile(profileId),
    repos.visits.byProfile(profileId),
  ]);
  const prescriptionLines = await repos.prescriptionLines.byDocuments(documents.map((d) => d.id));
  return { profile, prescribers, medicines, events, documents, prescriptionLines, reviewItems, visits };
}

/**
 * Stores a plan and returns the state as it now is. Call it inside `repos.transaction`
 * so the whole plan is stored or none of it.
 */
export async function storePlan(repos: Repos, state: RulesState, plan: WritePlan): Promise<RulesState> {
  const after = applyPlan(state, plan);

  await repos.medicines.bulkPut(plan.medicines);
  await repos.events.bulkPut(plan.events);
  await repos.reviewItems.bulkPut(plan.reviewItems);
  await repos.prescriptionLines.bulkPut(plan.prescriptionLines);
  await repos.documents.bulkPut(plan.documents);
  // Includes visits that only lost a deleted document from their list of reports to share.
  await repos.visits.bulkPut(after.visits.filter((visit) => !state.visits.includes(visit)));

  await repos.reviewItems.bulkDelete(plan.deletedReviewItemIds);
  for (const documentId of plan.deletedDocumentIds) {
    await repos.prescriptionLines.deleteByDocument(documentId);
    await repos.files.delete(documentId);
    await repos.documents.delete(documentId);
  }
  return after;
}
