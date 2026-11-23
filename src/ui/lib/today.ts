// "Today" for display. Every date the UI shows goes through todayFor (src/contract/today.ts):
// the sample profiles keep their own calendar, every other profile uses the device's date.
import { todayFor } from '../../contract/today';
import type { ID, ISODate } from '../../contract/types';

/** The device's local calendar date, as YYYY-MM-DD. */
export function deviceToday(): ISODate {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today" for a profile (null: no profile open, so the device's date). */
export function todayForProfile(profileId: ID | null): ISODate {
  return todayFor(profileId, deviceToday());
}
