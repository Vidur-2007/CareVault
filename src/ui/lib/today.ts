import { SAMPLE_TODAY } from '../../contract/fixtures/sampleCase';
import type { ISODate } from '../../contract/types';

/**
 * "Today" for display (date line, ages). With the mock services it is fixed at SAMPLE_TODAY,
 * matching the mock's own clock; otherwise it is the device's local date.
 */
export function today(): ISODate {
  if (import.meta.env.VITE_USE_MOCK === 'true') return SAMPLE_TODAY;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
