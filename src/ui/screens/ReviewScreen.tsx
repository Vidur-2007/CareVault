// Review (home), UI spec 7.2. Matches docs/design/CareVault-Main.png (desktop) and CareVault-Mobile.png (phone).
import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DocumentRecord, Medicine, ReviewItem, ReviewResolution } from '../../contract/legacy/types';
import { useMotionPresets } from '../app/motion';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorPanel } from '../components/ErrorPanel';
import { ReviewCard } from '../components/ReviewCard';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonCard, SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatWeekdayDate } from '../lib/format';
import { pronounsFor } from '../lib/pronouns';
import { today as getToday } from '../lib/today';
import type { VisitContext } from './review/copy';
import { NextVisitPanel } from './review/NextVisitPanel';
import { RecentRecords } from './review/RecentRecords';
import { ReviewHeader } from './review/ReviewHeader';
import { SinceLastVisit } from './review/SinceLastVisit';
import { useDeferredResolutions } from '../hooks/useDeferredResolutions';

function medicineNames(item: ReviewItem, medicines: Medicine[] | undefined): string {
  const names = item.medicineIds.map((id) => medicines?.find((m) => m.id === id)?.productName).filter(Boolean);
  return names.length ? names.join(' and ') : 'this medicine';
}

function toastMessage(item: ReviewItem, resolution: ReviewResolution, medicines: Medicine[] | undefined, doc: DocumentRecord | null): string {
  const name = medicineNames(item, medicines);
  switch (resolution) {
    case 'still_taking':
      return `Marked ${name} as still taken`;
    case 'stopped':
      return `Marked ${name} as stopped`;
    case 'ask_doctor':
      return 'Added to the questions for the doctor';
    case 'added':
      return `Added ${doc?.title ?? 'the document'} to the records`;
    case 'dismissed':
      return `Removed ${doc?.title ?? 'the document'}`;
    case 'only_one':
      return 'Saved which product is taken';
  }
}

export function ReviewScreen() {
  const { profile, prescribers } = useProfile();
  // The shell only renders screens once a profile exists.
  const pid = profile!.id;
  const navigate = useNavigate();
  const presets = useMotionPresets();
  const today = getToday();
  const [hour] = useState(() => new Date().getHours());

  const items = useServiceQuery((s) => s.review.listOpen(pid), [pid]);
  const visitQuery = useServiceQuery((s) => s.visits.next(pid), [pid]);
  const summary = useServiceQuery((s) => s.visits.changeSummary(pid), [pid]);
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const medicines = useServiceQuery((s) => s.medicines.list(pid), [pid]);
  const prescriberId = visitQuery.data?.prescriberId ?? null;
  const diff = useServiceQuery((s) => s.prescriptions.latestDiff(pid, prescriberId ?? ''), [pid, prescriberId], {
    enabled: prescriberId !== null,
  });

  const { hidden, answer } = useDeferredResolutions();
  const [confirmStop, setConfirmStop] = useState<ReviewItem | null>(null);

  const open = useMemo(() => (items.data ?? []).filter((i) => !hidden.has(i.id)), [items.data, hidden]);
  const count = items.data && !items.error ? open.length : null;
  const visit: VisitContext | null = useMemo(() => {
    const v = visitQuery.data;
    if (!v) return null;
    return { visit: v, prescriber: prescribers.find((p) => p.id === v.prescriberId) ?? null };
  }, [visitQuery.data, prescribers]);
  const pronouns = pronounsFor(profile!.relation);
  const docById = (id: string | null) => (id ? documents.data?.find((d) => d.id === id) ?? null : null);

  const resolve = (item: ReviewItem, resolution: ReviewResolution) =>
    answer(item.id, resolution, toastMessage(item, resolution, medicines.data, docById(item.documentId)));

  const onResolve = (item: ReviewItem) => (resolution: ReviewResolution) => {
    if (resolution === 'stopped') setConfirmStop(item);
    else resolve(item, resolution);
  };

  const list = (() => {
    if (items.loading) return <SkeletonList count={3} label="Loading things to review" />;
    if (items.error) {
      return <ErrorPanel title="Things to review could not be loaded" message={items.error.message} onRetry={items.reload} />;
    }
    if (open.length === 0) {
      return (
        <EmptyState
          icon={<CircleCheck />}
          title="Nothing needs your review"
          action={
            <Button to="/medicines/scan" variant="secondary">
              Scan a medicine
            </Button>
          }
        >
          {visit
            ? `Next visit: ${formatWeekdayDate(visit.visit.at)}${visit.prescriber ? ` with ${visit.prescriber.name}` : ''}.`
            : 'No visit is planned yet.'}
        </EmptyState>
      );
    }
    // First paint staggers in (40 ms steps, capped); answered cards collapse out; undone cards fade back in.
    return (
      <ul className="flex flex-col gap-4 md:gap-5">
        <AnimatePresence>
          {open.map((item, i) => (
            <motion.li
              key={item.id}
              layout={!presets.reduced}
              initial="hidden"
              animate="show"
              custom={i}
              variants={presets.listItem}
              exit={presets.collapse.exit}
              transition={presets.collapse.transition}
              className="overflow-hidden"
            >
              <ReviewCard
                item={item}
                document={docById(item.documentId)}
                pronouns={pronouns}
                onResolve={onResolve(item)}
                onViewPrescriptions={() => navigate('/visit')}
                onReviewProducts={() => navigate('/medicines#possible-duplicates')}
                onOpenDocument={item.documentId ? () => navigate(`/records/${item.documentId}`) : undefined}
                onViewOriginal={() => navigate(item.documentId ? `/records/${item.documentId}` : '/medicines')}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    );
  })();

  return (
    <div className="page-gutter py-6 md:py-12">
      <ReviewHeader profile={profile!} count={count} visit={visit} visitLoading={visitQuery.loading} today={today} hour={hour} />

      <div className="mt-6 grid gap-6 md:mt-10 wide:grid-cols-[minmax(0,1fr)_428px] wide:gap-8">
        <section aria-labelledby="things-to-review-title" className="min-w-0">
          <SectionHeader
            id="things-to-review-title"
            title="Things to review"
            aside={count !== null && count > 0 ? `${count} open` : undefined}
            className="sr-only md:not-sr-only md:mb-4 md:flex"
          />
          {list}
        </section>

        <aside aria-label="Visit overview" className="flex min-w-0 flex-col gap-6">
          <div className="hidden md:block">
            {visitQuery.loading ? (
              <SkeletonCard lines={3} />
            ) : visitQuery.error ? (
              <ErrorPanel title="The next visit could not be loaded" message={visitQuery.error.message} onRetry={visitQuery.reload} />
            ) : (
              <NextVisitPanel visit={visit} openCount={count} />
            )}
          </div>
          {summary.loading ? (
            <div role="status" aria-label="Loading changes since the last visit">
              <Skeleton className="h-64 w-full rounded-card" />
            </div>
          ) : summary.error ? (
            <ErrorPanel title="Changes could not be loaded" message={summary.error.message} onRetry={summary.reload} />
          ) : summary.data ? (
            <SinceLastVisit summary={summary.data} />
          ) : null}
        </aside>
      </div>

      {documents.error ? (
        <ErrorPanel className="mt-12" title="Recent records could not be loaded" message={documents.error.message} onRetry={documents.reload} />
      ) : documents.data ? (
        <RecentRecords documents={documents.data} diff={diff.data ?? null} />
      ) : null}

      <ConfirmDialog
        open={confirmStop !== null}
        title={confirmStop ? `Mark ${medicineNames(confirmStop, medicines.data)} as stopped?` : ''}
        message="You can change this later."
        confirmLabel="Mark as stopped"
        onCancel={() => setConfirmStop(null)}
        onConfirm={() => {
          if (confirmStop) resolve(confirmStop, 'stopped');
          setConfirmStop(null);
        }}
      />
    </div>
  );
}
