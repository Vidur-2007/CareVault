// Visit (UI spec 7.8). Phase 4 shows the prescription comparison so an uploaded prescription lands
// on its result; questions, reports, the status panel and the passport link come in phase 5.
import { useLocation } from 'react-router';
import { DiffRow } from '../components/DiffRow';
import { ErrorPanel } from '../components/ErrorPanel';
import { SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatDate } from '../lib/format';

export function VisitScreen() {
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const location = useLocation();
  const fromUpload = (location.state as { prescriberId?: string } | null)?.prescriberId ?? null;

  const visit = useServiceQuery((s) => s.visits.next(pid), [pid]);
  const prescriberId = fromUpload ?? visit.data?.prescriberId ?? null;
  const diff = useServiceQuery((s) => s.prescriptions.latestDiff(pid, prescriberId ?? ''), [pid, prescriberId], {
    enabled: prescriberId !== null,
  });
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const prescriber = prescribers.find((p) => p.id === prescriberId) ?? null;
  const dateOf = (id: string | null) => {
    const d = id ? documents.data?.find((x) => x.id === id) : undefined;
    return d ? formatDate(d.documentDate) : null;
  };

  return (
    <div className="page-gutter py-6 md:py-12">
      <h1 className="text-page-sm md:text-page">What changed since the last visit</h1>
      {prescriber && (
        <p className="mt-3 max-w-3xl text-ink-2 md:text-[20px] md:leading-[1.5]">
          Comparing {prescriber.name}’s two prescriptions. Medicines from other doctors are not compared here.
        </p>
      )}

      <div className="mt-8 max-w-3xl">
        {visit.loading || (prescriberId !== null && diff.loading) ? (
          <SkeletonList count={3} label="Loading the comparison" />
        ) : diff.error ? (
          <ErrorPanel title="The comparison could not be loaded" message={diff.error.message} onRetry={diff.reload} />
        ) : !diff.data ? (
          <p className="text-ink-2">There is no prescription to compare yet.</p>
        ) : (
          <>
            <p className="mb-4 text-secondary text-ink-3">
              {diff.data.previousDocumentId
                ? `Previous ${dateOf(diff.data.previousDocumentId) ?? ''} · Latest ${dateOf(diff.data.latestDocumentId) ?? ''}`
                : 'This is the first prescription from this doctor in CareVault, so every medicine is listed as added.'}
            </p>
            <div className="flex flex-col gap-4">
              {diff.data.rows.map((row, i) => (
                <DiffRow key={`${row.kind}-${row.latest?.id ?? row.previous?.id ?? i}`} row={row} />
              ))}
            </div>
          </>
        )}
        <p className="mt-8 text-ink-3">Questions for the doctor, reports to share and the visit passport are built in phase 5.</p>
      </div>
    </div>
  );
}
