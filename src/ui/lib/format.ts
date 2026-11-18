// Date and number formatting. ISO dates ('YYYY-MM-DD') are parsed by hand so the
// device time zone never shifts the calendar day.
import type { ISODate, ISODateTime } from '../../contract/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(iso: ISODate | ISODateTime) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

/** '2026-11-12' -> '12 Nov 2026' */
export function formatDate(iso: ISODate | ISODateTime): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** '2026-11-12' -> '12 November 2026' */
export function formatLongDate(iso: ISODate | ISODateTime): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** '2026-10-28' -> '28 Oct' */
export function formatShortDate(iso: ISODate | ISODateTime): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** '2026-11-18' -> 'Wednesday, 18 November' */
export function formatWeekdayDate(iso: ISODate | ISODateTime): string {
  const { m, d, weekday } = parts(iso);
  return `${WEEKDAYS[weekday]}, ${d} ${MONTHS[m - 1]}`;
}

/** '2026-11-18' -> 'Wed 18 Nov' */
export function formatShortWeekdayDate(iso: ISODate | ISODateTime): string {
  const { m, d, weekday } = parts(iso);
  return `${WEEKDAYS[weekday].slice(0, 3)} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** '2026-10-28' -> '28 October' */
export function formatDayMonth(iso: ISODate | ISODateTime): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** '2026-11-18' -> 'Wednesday' */
export function formatWeekday(iso: ISODate | ISODateTime): string {
  return WEEKDAYS[parts(iso).weekday];
}

/** Whole calendar days from `from` to `to` (both read as calendar dates). */
export function daysBetween(from: ISODate | ISODateTime, to: ISODate | ISODateTime): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** '2026-11-18T10:30:00+05:30' -> '10:30 am' (the wall-clock time written in the value). */
export function formatTime(iso: ISODateTime): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return '';
  const h = Number(match[1]);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${match[2]} ${suffix}`;
}

/** 3450 -> '3,450'. At most 3 decimals. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function ageFrom(birthYear: number | null, today: ISODate): number | null {
  return birthYear === null ? null : Number(today.slice(0, 4)) - birthYear;
}

/** '2026-11-18T10:30:00+05:30' -> 'Wednesday, 18 Nov, 10:30 am' (the appointment-mode pill). */
export function formatVisitPill(iso: ISODateTime): string {
  return `${formatWeekday(iso)}, ${formatShortDate(iso)}, ${formatTime(iso)}`;
}

/** An instant (e.g. a link expiry) in the device's local time: 'Wednesday, 18 November, 8:00 pm'. */
export function formatLocalDateTime(iso: ISODateTime): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}

/** Date and time typed into the form, as ISO 8601 with the device's offset: '2026-11-25T10:30:00+05:30'. */
export function localDateTimeIso(date: string, time: string): ISODateTime {
  const d = new Date(`${date}T${time}:00`);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

/** An instant in the device's local time, short: '18 Nov, 8 pm' or '19 Nov, 6:07 am'. */
export function formatLocalShort(iso: ISODateTime): string {
  const d = new Date(iso);
  const h = d.getHours();
  const minutes = d.getMinutes();
  const time = `${h % 12 === 0 ? 12 : h % 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, ${time}`;
}
