// The next visit and its list of questions for the doctor.
import { ServiceError, type ISODate, type Question, type Visit } from '../../contract/legacy/types';
import { emptyPlan, type RuleContext, type RulesState, type WritePlan } from './types';

/**
 * The earliest visit on or after `today`. The day is read from the visit's own text, so
 * a visit stays "today" until that calendar day is over wherever it was booked.
 */
export function nextVisit(state: RulesState, today: ISODate): Visit | null {
  return (
    state.visits
      .filter((visit) => visit.at.slice(0, 10) >= today)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))[0] ?? null
  );
}

/** Adds a question to a visit. The same text is never added twice. */
export function planAddQuestion(
  visit: Visit,
  text: string,
  source: Question['source'],
  ctx: RuleContext,
): WritePlan {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new ServiceError('unknown', 'Please type a question first.');
  const plan = emptyPlan();
  if (visit.questions.some((q) => q.text.toLowerCase() === trimmed.toLowerCase())) return plan;
  plan.visits.push({
    ...visit,
    questions: [...visit.questions, { id: ctx.newId('question', trimmed), text: trimmed, source }],
  });
  return plan;
}
