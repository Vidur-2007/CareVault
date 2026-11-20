// CareVault contract v2: "today" for each profile.
// FROZEN after Phase 0. Copied from docs/specs/00-overview.spec.md, section 8; change only
// through docs/contract-requests-<side>.md. The v1 contract is in ./legacy until the merge checkpoint.

import { SAMPLE_PROFILE_IDS, SAMPLE_TODAY } from './fixtures/sampleCase';
import type { ID, ISODate } from './types';

/** "Today" for a profile. The sample profiles keep their own calendar so the demo never ages. */
export function todayFor(profileId: ID | null, deviceToday: ISODate): ISODate {
  return profileId !== null && (SAMPLE_PROFILE_IDS as readonly string[]).includes(profileId)
    ? SAMPLE_TODAY
    : deviceToday;
}
