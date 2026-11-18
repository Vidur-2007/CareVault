// Wording for the Review screen (UI spec 7.2, CareVault-Main.png / CareVault-Mobile.png).
// Pure functions so every variant is unit-tested.
import type { ISODate, Prescriber, Profile, Visit } from '../../../contract/types';
import { daysBetween, formatDayMonth, formatShortWeekdayDate, formatTime, formatWeekday } from '../../lib/format';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** 3 -> 'Three' (or 'three'); numbers above ten stay as digits. */
export function numberWord(n: number, capital = true): string {
  const word = n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
  return capital ? word : word.toLowerCase();
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** 'Dr. Kavita Rao' -> 'Dr. Rao' */
export function shortDoctorName(name: string): string {
  const words = name.replace(/^dr\.?\s+/i, '').trim().split(/\s+/);
  return `Dr. ${words[words.length - 1]}`;
}

/** 'today', 'tomorrow', 'on Wednesday' (within six days) or 'on 18 November'. */
export function visitWhen(visitAt: string, today: ISODate): string {
  const days = daysBetween(today, visitAt);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days <= 6) return `on ${formatWeekday(visitAt)}`;
  return `on ${formatDayMonth(visitAt)}`;
}

/** "your father's" from the relation; the patient's name when there is no relation. */
export function possessiveFor(profile: Pick<Profile, 'name' | 'relation'>): string {
  const relation = profile.relation.trim().toLowerCase();
  return relation ? `your ${relation}'s` : `${firstName(profile.name)}'s`;
}

export interface VisitContext {
  visit: Pick<Visit, 'at'>;
  prescriber: Pick<Prescriber, 'name' | 'specialty'> | null;
}

function visitNoun(ctx: VisitContext): string {
  const specialty = ctx.prescriber?.specialty.trim().toLowerCase();
  return specialty ? `${specialty} visit` : 'next visit';
}

/** Desktop line under the greeting. */
export function answerSentence(count: number, profile: Pick<Profile, 'name' | 'relation'>, ctx: VisitContext | null, today: ISODate): string {
  if (count === 0) {
    return ctx ? `Nothing needs your answer before ${possessiveFor(profile)} ${visitNoun(ctx)} ${visitWhen(ctx.visit.at, today)}.` : 'Nothing needs your answer right now.';
  }
  const subject = `${numberWord(count)} ${plural(count, 'thing needs', 'things need')} your answer`;
  return ctx ? `${subject} before ${possessiveFor(profile)} ${visitNoun(ctx)} ${visitWhen(ctx.visit.at, today)}.` : `${subject}.`;
}

/** Phone title: '3 things to review'. */
export function phoneTitle(count: number): string {
  return count === 0 ? 'Nothing to review' : `${count} ${plural(count, 'thing', 'things')} to review`;
}

/** Phone line under the title: 'Before the cardiology visit on Wednesday.' */
export function phoneSubline(ctx: VisitContext | null, today: ISODate): string {
  return ctx ? `Before the ${visitNoun(ctx)} ${visitWhen(ctx.visit.at, today)}.` : 'No visit is planned yet.';
}

/** Phone next-visit link: 'Wed 18 Nov, 10:30 am · Dr. Rao'. */
export function compactVisitLine(ctx: VisitContext): string {
  const when = `${formatShortWeekdayDate(ctx.visit.at)}, ${formatTime(ctx.visit.at)}`;
  return ctx.prescriber ? `${when} · ${shortDoctorName(ctx.prescriber.name)}` : when;
}

/** Last line of the Next visit panel. */
export function passportReadySentence(count: number): string {
  if (count === 0) return 'Everything is answered. The visit passport is ready.';
  if (count === 1) return 'The visit passport is ready once the last review item is answered.';
  return `The visit passport is ready once the ${numberWord(count, false)} review items are answered.`;
}
