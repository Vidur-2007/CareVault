// Visit, appointment mode (UI spec 7.8). Matches docs/design/CareVault-Changes.png.
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import type { DocumentRecord, ReviewResolution } from '../../contract/types';
import { DiffRow } from '../components/DiffRow';
import { ErrorPanel } from '../components/ErrorPanel';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useDeferredResolutions } from '../hooks/useDeferredResolutions';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { formatLongDate, formatVisitPill } from '../lib/format';
import { pronounsFor } from '../lib/pronouns';
import { today as getToday } from '../lib/today';
import { AddVisitForm } from './visit/AddVisitForm';
import { QuestionsCard } from './visit/QuestionsCard';
import { ReportsCard } from './visit/ReportsCard';
import { StatusBar, StatusPanel } from './visit/StatusPanel';
import { orderRows, rowFootnote, unansweredCount } from './visit/visitText';

/** Medicines match by their set of ingredient names, never by brand (overview spec section 9). */
const ingredientSet = (ingredients: { name: string }[]) => ingredients.map((i) => i.name.trim().toLowerCase()).sort().join('+');

const ANSWER_TOAST: Partial<Record<ReviewResolution, string>> = {
  still_taking: 'still taken',
  stopped: 'stopped',
};

function DateTile({ label, doc, tone }: { label: string; doc: DocumentRecord | null; tone: 'previous' | 'latest' }) {
  return (
    <div className={cx('rounded-panel p-4 md:p-5', tone === 'latest' ? 'bg-teal-tint text-teal-ink' : 'bg-grey-tint text-grey-ink')}>
      <p className="text-secondary font-semibold">{label}</p>
      {doc ? (
        <>
          <p className="mt-1 text-[18px] font-semibold text-ink md:text-[20px]">{formatLongDate(doc.documentDate)}</p>
          <Link to={`/records/${doc.id}`} className="mt-1 inline-block font-semibold text-teal underline decoration-2 underline-offset-4 hover:text-teal-ink">
            Open the scan<span className="sr-only"> of the {label.toLowerCase()} prescription</span>
          </Link>
        </>
      ) : (
        <p className="mt-1 text-ink-2">No earlier prescription in CareVault</p>
      )}
    </div>
  );
}

export function VisitScreen() {
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const pronouns = pronounsFor(profile!.relation);
  const location = useLocation();
  const fromUpload = (location.state as { prescriberId?: string } | null)?.prescriberId ?? null;

  const visitQuery = useServiceQuery((s) => s.visits.next(pid), [pid]);
  const visit = visitQuery.data ?? null;
  const prescriberId = fromUpload ?? visit?.prescriberId ?? null;
  const diff = useServiceQuery((s) => s.prescriptions.latestDiff(pid, prescriberId ?? ''), [pid, prescriberId], {
    enabled: prescriberId !== null,
  });
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const openItems = useServiceQuery((s) => s.review.listOpen(pid), [pid]);
  const medicines = useServiceQuery((s) => s.medicines.list(pid), [pid]);
  const { hidden, answer } = useDeferredResolutions();

  const prescriber = prescribers.find((p) => p.id === prescriberId) ?? null;
  const docById = (id: string | null) => (id ? documents.data?.find((d) => d.id === id) ?? null : null);
  const rows = useMemo(() => orderRows(diff.data?.rows ?? []), [diff.data]);
  const latestDoc = docById(diff.data?.latestDocumentId ?? null);
  const previousDoc = docById(diff.data?.previousDocumentId ?? null);
  const count = unansweredCount(rows, openItems.data ?? [], hidden);

  const answerRow = (itemId: string, name: string) => (resolution: ReviewResolution) => {
    const what = ANSWER_TOAST[resolution];
    answer(itemId, resolution, what ? `Marked ${name} as ${what}` : 'Added to the questions for the doctor');
  };

  if (visitQuery.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        <Skeleton className="h-8 w-72 rounded-full" />
        <Skeleton className="mt-5 h-12 w-full max-w-xl" />
        <div className="mt-8">
          <SkeletonList count={3} label="Loading the visit" />
        </div>
      </div>
    );
  }

  if (visitQuery.error) {
    return (
      <div className="page-gutter py-6 md:py-12">
        <h1 className="text-page-sm md:text-page">What changed since the last visit</h1>
        <ErrorPanel className="mt-6" title="The next visit could not be loaded" message={visitQuery.error.message} onRetry={visitQuery.reload} />
      </div>
    );
  }

  const comparison = (
    <section aria-labelledby="comparison-title" className="min-w-0">
      <SectionHeader id="comparison-title" title="Prescription comparison" />
      {prescriberId === null ? (
        <p className="text-ink-2">Add a visit to compare that doctor’s prescriptions.</p>
      ) : diff.loading ? (
        <SkeletonList count={3} label="Loading the comparison" />
      ) : diff.error ? (
        <ErrorPanel title="The comparison could not be loaded" message={diff.error.message} onRetry={diff.reload} />
      ) : !diff.data ? (
        <p className="rounded-panel bg-surface-muted p-5 text-ink-2">
          There is no prescription from {prescriber?.name ?? 'this doctor'} yet.{' '}
          <Link to="/records" className="font-semibold text-teal underline underline-offset-4">
            Add one in Records
          </Link>{' '}
          to see what changed.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <DateTile label="Previous" doc={previousDoc} tone="previous" />
            <DateTile label="Latest" doc={latestDoc} tone="latest" />
          </div>
          {diff.data.previousDocumentId === null && (
            <p className="mt-4 rounded-panel bg-blue-tint px-4 py-3 text-blue-ink">
              This is the first prescription from {prescriber?.name ?? 'this doctor'} in CareVault, so every medicine is listed as added. The next
              prescription will be compared with this one.
            </p>
          )}
          <ol className="mt-4 flex flex-col gap-4">
            {rows.map((row, i) => {
              const answered = row.reviewItemId !== null && (hidden.has(row.reviewItemId) || !(openItems.data ?? []).some((it) => it.id === row.reviewItemId));
              const stillUnconfirmed =
                row.kind === 'review' && row.previous
                  ? (medicines.data ?? []).some((m) => m.status === 'needs_confirmation' && ingredientSet(m.ingredients) === ingredientSet(row.previous!.ingredients))
                  : false;
              return (
                <li key={`${row.kind}-${row.latest?.id ?? row.previous?.id ?? i}`}>
                  <DiffRow
                    row={row}
                    footnote={
                      row.kind === 'review' && answered
                        ? stillUnconfirmed
                          ? 'Answered: it will be asked at the visit.'
                          : 'Answered.'
                        : rowFootnote(row, pronouns, latestDoc?.documentDate ?? null)
                    }
                    onResolve={
                      row.kind === 'review' && row.reviewItemId && !answered ? answerRow(row.reviewItemId, row.previous?.productName ?? 'it') : undefined
                    }
                  />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );

  return (
    <div className={cx('page-gutter py-6 md:py-12', visit && 'pb-24 wide:pb-12')}>
      {visit ? (
        <p className="inline-flex rounded-full bg-teal-dark px-4 py-1.5 text-pill font-semibold text-white">
          Appointment mode · {formatVisitPill(visit.at)}
        </p>
      ) : null}
      <h1 className={cx('text-page-sm md:text-page', visit && 'mt-4')}>What changed since the last visit</h1>
      {prescriber && (
        <p className="mt-3 max-w-3xl text-ink-2 md:text-[20px] md:leading-[1.5]">
          Comparing {prescriber.name}’s two prescriptions. Medicines from other doctors are not compared here.
        </p>
      )}

      {!visit && (
        <div className="mt-8">
          <AddVisitForm profileId={pid} prescribers={prescribers} today={getToday()} defaultPrescriberId={prescriberId} />
        </div>
      )}

      <div className={cx('mt-8 grid gap-6 md:mt-10', visit && 'wide:grid-cols-[minmax(0,1fr)_416px] wide:gap-8')}>
        {comparison}
        {visit && (
          <aside aria-label="Prepare the visit" className="flex min-w-0 flex-col gap-6">
            <QuestionsCard visit={visit} />
            {documents.data && <ReportsCard visit={visit} documents={documents.data} />}
            <StatusPanel count={count} />
          </aside>
        )}
      </div>

      {visit && <StatusBar count={count} />}
    </div>
  );
}
