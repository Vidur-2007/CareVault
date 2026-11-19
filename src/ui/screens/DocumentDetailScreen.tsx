// Document detail, UI spec 7.7: preview with pages and zoom, metadata, star, confirm, delete.
import { ArrowLeft, CircleCheck, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { PrescriptionLine } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useProfile, useToast } from '../hooks/useContexts';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { formatDate } from '../lib/format';
import { DOCUMENT_TYPE_LABEL, sourceLabel } from '../lib/labels';
import { DocumentPreview } from './records/DocumentPreview';

export function DocumentDetailScreen() {
  const { id = '' } = useParams();
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const navigate = useNavigate();
  const toast = useToast();

  const doc = useServiceQuery((s) => s.documents.get(id), [id]);
  const file = useServiceQuery((s) => s.documents.file(id), [id]);
  const openItems = useServiceQuery((s) => s.review.listOpen(pid), [pid]);
  const prescriberId = doc.data?.type === 'prescription' ? doc.data.prescriberId : null;
  const diff = useServiceQuery((s) => s.prescriptions.latestDiff(pid, prescriberId ?? ''), [pid, prescriberId], {
    enabled: prescriberId !== null,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A pending email document has an open "new document" review item; answer that so Review stays in step.
  const reviewItem = openItems.data?.find((i) => i.kind === 'new_document' && i.documentId === id) ?? null;

  const star = useServiceAction((s, on: boolean) => s.documents.star(id, on), {
    success: (d) => (d.starred ? 'Starred' : 'Removed the star'),
  });
  const confirm = useServiceAction(
    async (s) => (reviewItem ? s.review.resolve(reviewItem.id, 'added') : s.documents.confirm(id).then(() => undefined)),
    { success: 'Confirmed and kept in the records' },
  );
  const remove = useServiceAction(async (s) => (reviewItem ? s.review.resolve(reviewItem.id, 'dismissed') : s.documents.remove(id)), {
    errorPrefix: 'The record could not be deleted',
    rethrow: true,
  });

  const back = (
    <Link to="/records" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Records
    </Link>
  );

  if (doc.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <Skeleton className="mt-4 h-11 w-2/3 max-w-md" />
        <div className="mt-8">
          <SkeletonList count={2} label="Loading the record" />
        </div>
      </div>
    );
  }

  if (doc.error || !doc.data) {
    const notFound = doc.error?.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Record not found' : 'Record'}</h1>
        <ErrorPanel
          className="mt-6"
          title={notFound ? 'This record is not in the vault' : 'This record could not be loaded'}
          message={notFound ? 'It may have been deleted, or the link is from another profile.' : doc.error?.message}
          onRetry={notFound ? undefined : doc.reload}
        />
      </div>
    );
  }

  const d = doc.data;
  const prescriber = prescribers.find((p) => p.id === d.prescriberId) ?? null;
  const pending = d.state === 'pending_confirmation';

  // Lines are available for the two most recent prescriptions from this doctor (through the comparison).
  let lines: PrescriptionLine[] | null = null;
  if (diff.data?.latestDocumentId === d.id) lines = diff.data.rows.map((r) => r.latest).filter((l): l is PrescriptionLine => !!l);
  else if (diff.data?.previousDocumentId === d.id) lines = diff.data.rows.map((r) => r.previous).filter((l): l is PrescriptionLine => !!l);

  const rows: [string, string][] = [
    ['Type', DOCUMENT_TYPE_LABEL[d.type]],
    ['Date on the document', formatDate(d.documentDate)],
    ['Doctor', prescriber ? `${prescriber.name}, ${prescriber.specialty.toLowerCase()}` : 'Not from a doctor'],
    ['How it was added', `${sourceLabel(d)[0].toUpperCase()}${sourceLabel(d).slice(1)}, ${formatDate(d.addedAt)}`],
    ['Status', pending ? 'Not yet confirmed' : 'Confirmed'],
  ];

  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-page-sm md:text-page">{d.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="grey">{DOCUMENT_TYPE_LABEL[d.type]}</Pill>
            {pending ? <Pill tone="amber">Not yet confirmed</Pill> : <Pill tone="teal">Confirmed</Pill>}
            {d.starred && <Pill tone="amber">Starred</Pill>}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={d.starred}
          onClick={() => void star.run(!d.starred)}
          disabled={star.pending}
          className={cx(
            'inline-flex min-h-12 shrink-0 items-center gap-2 self-start rounded-button border px-4 font-semibold transition-colors disabled:opacity-60',
            d.starred ? 'border-amber-ink/50 bg-amber-tint text-amber-ink' : 'border-teal bg-surface text-teal-ink hover:bg-teal-tint',
          )}
        >
          <Star aria-hidden className={cx('size-5', d.starred && 'fill-amber-ink')} />
          {d.starred ? 'Starred' : 'Star'}
        </button>
      </header>

      <div className="mt-8 grid gap-6 wide:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] wide:gap-8">
        <DocumentPreview key={d.id} file={file.data ?? null} title={d.title} error={file.error ? `The file could not be opened. ${file.error.message}` : null} />

        <div className="flex min-w-0 flex-col gap-6">
          {pending && (
            <Card tone="action">
              <h2 className="font-sans text-card-sm font-semibold">Is this {profile!.name.split(' ')[0]}’s record?</h2>
              <p className="mt-2 text-ink-2">
                It is not confirmed yet{d.source === 'email' ? ' because it came from email' : ''}. Confirm it to share it at the visit.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Button icon={<CircleCheck aria-hidden className="size-5" />} onClick={() => void confirm.run()} loading={confirm.pending}>
                  Confirm this record
                </Button>
              </div>
            </Card>
          )}

          <Card as="section" aria-labelledby="record-details-title">
            <h2 id="record-details-title" className="font-sans text-card-sm font-semibold">
              Details
            </h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-secondary font-semibold text-ink-3">{label}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {d.type === 'prescription' && (
            <section aria-labelledby="rx-lines-title">
              <SectionHeader id="rx-lines-title" level={3} title="Medicines on this prescription" />
              {lines && lines.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {lines.map((l) => (
                    <li key={l.id} className="rounded-panel bg-surface-muted px-4 py-3">
                      <span className="font-semibold text-ink">{l.productName}</span>
                      <span className="block text-secondary text-ink-2">{l.instruction || 'No instruction entered'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">
                  {diff.loading ? 'Loading…' : 'The medicines are listed for the two most recent prescriptions from each doctor.'}
                </p>
              )}
              {prescriber && (
                <Button
                  variant="quiet"
                  className="mt-2 -ml-1"
                  onClick={() => navigate('/visit', { state: { prescriberId: prescriber.id, documentId: d.id } })}
                >
                  See the comparison
                </Button>
              )}
            </section>
          )}

          <div className="border-t border-line pt-6">
            <Button variant="secondary" icon={<Trash2 aria-hidden className="size-5" />} onClick={() => setConfirmDelete(true)} className="!border-red-line !text-red-ink hover:!bg-red-tint">
              Delete this record
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${d.title}?`}
        message="The file and its details are removed from this device. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        pending={remove.pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const title = d.title;
          try {
            await remove.run();
          } catch {
            return; // the error toast is already shown; the dialog stays open to try again
          }
          setConfirmDelete(false);
          toast.show({ message: `Deleted ${title}`, tone: 'success' });
          navigate('/records');
        }}
      />
    </div>
  );
}
