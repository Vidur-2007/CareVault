import { ChevronRight, Stethoscope } from 'lucide-react';
import { Link } from 'react-router';
import type { Profile } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Skeleton } from '../../components/Skeleton';
import { formatWeekdayDate } from '../../lib/format';
import { answerSentence, compactVisitLine, firstName, greeting, phoneSubline, phoneTitle } from './copy';
import type { VisitContext } from './copy';

export interface ReviewHeaderProps {
  profile: Profile;
  /** Open items still showing; null while loading or on error. */
  count: number | null;
  visit: VisitContext | null;
  visitLoading: boolean;
  today: string;
  hour: number;
}

/**
 * Desktop: date line, greeting, sentence and "Prepare for the visit" (CareVault-Main.png).
 * Phone: "3 things to review", the visit line and a compact next-visit link (CareVault-Mobile.png).
 * One h1 whose visible wording depends on the breakpoint.
 */
export function ReviewHeader({ profile, count, visit, visitLoading, today, hour }: ReviewHeaderProps) {
  const ready = count !== null && !visitLoading;
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="min-w-0 md:max-w-[680px]">
        <p className="hidden text-body-sm text-ink-3 md:block">{formatWeekdayDate(today)}</p>
        <h1 className="text-page-sm md:mt-3 md:text-page">
          <span className="md:hidden">{count === null ? 'Things to review' : phoneTitle(count)}</span>
          <span className="hidden md:inline">
            {greeting(hour)}, {firstName(profile.caregiverName)}
          </span>
        </h1>
        {ready ? (
          <>
            <p className="mt-2 text-ink-2 md:hidden">{phoneSubline(visit, today)}</p>
            <p className="mt-4 hidden text-[20px] leading-[1.5] text-ink-2 md:block">{answerSentence(count, profile, visit, today)}</p>
          </>
        ) : count === null && !visitLoading ? null : (
          <Skeleton className="mt-4 h-6 w-full max-w-lg" />
        )}
      </div>

      {visit && (
        <>
          <div className="hidden shrink-0 md:block">
            <Button to="/visit" cta icon={<Stethoscope aria-hidden className="size-5" />}>
              Prepare for the visit
            </Button>
          </div>
          <Link
            to="/visit"
            className="flex items-center gap-3 rounded-panel bg-teal-dark px-[18px] py-4 text-white md:hidden"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-secondary text-white/80">Next visit</span>
              <span className="block font-semibold">{compactVisitLine(visit)}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0" />
          </Link>
        </>
      )}
    </header>
  );
}
