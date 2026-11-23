// Record detail, UI spec 4.5: the original with pages and zoom, the metadata (date source, patient
// match, pages read), edit, star, file and delete. Check the values and Review changes come in
// steps 4 and 6.
import { ArrowLeft, CircleCheck, Pencil, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DocumentRecord, Profile, ServiceError } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useProfile, useServices } from '../hooks/useContexts';
import { toServiceError } from '../hooks/toServiceError';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { formatDate } from '../lib/format';
import { dateSourceText, KIND_LABEL, pagesText, sourceLabel } from '../lib/labels';
import { DeleteRecordDialog } from './records/DeleteRecordDialog';
import { DocumentPreview } from './records/DocumentPreview';
import { EditDetailsDialog } from './records/EditDetailsDialog';

/**
 * The original file, fetched once per record. Not a subscribed query: other writes (a star, an
 * edit) must not fetch it again and restart the preview.
 */
function useOriginal(id: string, enabled: boolean) {
  const services = useServices();
  const [state, setState] = useState<{ id: string; blob: Blob | null; error: ServiceError | null }>({ id: '', blob: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    services.documents.file(id).then(
      (f) => !cancelled && setState({ id, blob: f.blob, error: null }),
      (err: unknown) => !cancelled && setState({ id, blob: null, error: toServiceError(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [services, id, enabled]);
  return state.id === id ? state : { blob: null, error: null };
}

function patientText(doc: DocumentRecord, profile: Profile): string {
  if (doc.patientMatch === 'not_found' || !doc.patientNameRead) return 'No patient name found on it';
  if (doc.patientMatch === 'match') return `${doc.patientNameRead} · matches ${profile.name}`;
  return `${doc.patientNameRead} · does not match ${profile.name}`;
}

export function RecordDetailScreen() {
  const { id = '' } = useParams();
  const { profile, prescribers } = useProfile();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doc = useServiceQuery((s) => s.documents.get(id), [id]);
  // A record of another profile is never shown here, even from an old link.
  const mine = doc.data && doc.data.profileId === profile!.id ? doc.data : null;
  const file = useOriginal(id, mine !== null);
  const isPrescription = mine?.kind === 'prescription';
  const lines = useServiceQuery((s) => s.prescriptions.lines(id), [id, isPrescription], { enabled: isPrescription });
  useDocumentTitle(mine?.title ?? 'Record');

  const star = useServiceAction((s, on: boolean) => s.documents.update(id, { starred: on }), {
    success: (d) => (d.starred ? 'Starred' : 'Removed the star'),
  });
  const fileIt = useServiceAction((s) => s.documents.fileRecord(id), { success: 'Filed in the records' });

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

  if (!mine) {
    const notFound = !doc.error || doc.error.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Record not found' : 'Record'}</h1>
        <ErrorPanel
          className="mt-6"
          title={notFound ? 'This record is not in these records' : 'This record could not be loaded'}
          message={notFound ? 'It may have been deleted, or the link is for another profile.' : doc.error?.message}
          onRetry={notFound ? undefined : doc.reload}
        />
      </div>
    );
  }

  const d = mine;
  const prescriber = prescribers.find((p) => p.id === d.prescriberId) ?? null;
  const pending = d.state === 'pending_review';
  const pages = pagesText(d);

  const rows: [string, string][] = [
    ['Kind', KIND_LABEL[d.kind]],
    ['Date on the document', d.clinicalDate ? `${formatDate(d.clinicalDate)} · ${dateSourceText(d)}` : dateSourceText(d)],
    ['Doctor', prescriber ? [prescriber.name, prescriber.specialty].filter(Boolean).join(', ') : 'Not from a doctor'],
    ['Facility', d.facility ?? 'Not known'],
    ['Tests', d.testNames.length ? d.testNames.join(', ') : 'None listed'],
    ['Labels', d.tags.length ? d.tags.join(', ') : 'None'],
    ['Patient on the document', patientText(d, profile!)],
    ...(pages ? [['Pages', pages] as [string, string]] : []),
    ['How it was added', `${sourceLabel(d)[0].toUpperCase()}${sourceLabel(d).slice(1)}, ${formatDate(d.addedAt)}`],
    ['Status', pending ? 'Not yet filed' : 'Filed'],
  ];

  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-page-sm md:text-page">{d.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="grey">{KIND_LABEL[d.kind]}</Pill>
            {pending ? <Pill tone="amber">Not yet filed</Pill> : <Pill tone="teal">Filed</Pill>}
            {!d.clinicalDate && <Pill tone="grey">Date not known</Pill>}
            {d.patientMatch === 'mismatch' && <Pill tone="red">Name does not match</Pill>}
            {d.starred && <Pill tone="amber">Starred</Pill>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-start">
          <button
            type="button"
            aria-pressed={d.starred}
            onClick={() => void star.run(!d.starred)}
            disabled={star.pending}
            className={cx(
              'inline-flex min-h-12 items-center gap-2 rounded-button border px-4 font-semibold transition-colors disabled:opacity-60',
              d.starred ? 'border-amber-ink/50 bg-amber-tint text-amber-ink' : 'border-teal bg-surface text-teal-ink hover:bg-teal-tint',
            )}
          >
            <Star aria-hidden className={cx('size-5', d.starred && 'fill-amber-ink')} />
            {d.starred ? 'Starred' : 'Star'}
          </button>
          <Button variant="secondary" icon={<Pencil aria-hidden className="size-5" />} onClick={() => setEditing(true)}>
            Edit the details
          </Button>
        </div>
      </header>

      <div className="mt-8 grid gap-6 wide:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] wide:gap-8">
        <DocumentPreview
          key={d.id}
          file={file.blob}
          title={d.title}
          error={file.error ? `The file could not be opened. ${file.error.message}` : null}
        />

        <div className="flex min-w-0 flex-col gap-6">
          {pending && (
            <Card tone="action">
              <h2 className="font-sans text-card-sm font-semibold">Not yet filed</h2>
              <p className="mt-2 text-ink-2">
                {d.source === 'email' ? 'It came from email. ' : ''}Check the details, then file it with the other records.
              </p>
              <Button className="mt-4" icon={<CircleCheck aria-hidden className="size-5" />} onClick={() => void fileIt.run()} loading={fileIt.pending}>
                File it
              </Button>
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

          {isPrescription && (
            <section aria-labelledby="rx-lines-title">
              <SectionHeader id="rx-lines-title" level={2} title="Medicines on this prescription" />
              {lines.loading ? (
                <SkeletonList count={2} lines={1} label="Loading the medicines" />
              ) : lines.error ? (
                <ErrorPanel title="The medicines could not be loaded" message={lines.error.message} onRetry={lines.reload} />
              ) : (lines.data ?? []).length === 0 ? (
                <p className="text-ink-3">No medicines have been saved from this prescription yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lines.data!.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 rounded-panel bg-surface-muted px-4 py-3">
                      <span className="min-w-0">
                        <span className="font-semibold text-ink">{l.productName}</span>
                        <span className="block text-secondary text-ink-2">{l.instruction || 'No instruction entered'}</span>
                      </span>
                      {l.verified ? <Pill tone="teal">Checked</Pill> : <Pill tone="check">Check this value</Pill>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className="border-t border-line pt-6">
            <Button
              variant="secondary"
              icon={<Trash2 aria-hidden className="size-5" />}
              onClick={() => setDeleting(true)}
              className="!border-red-line !text-red-ink hover:!bg-red-tint"
            >
              Delete this record
            </Button>
          </div>
        </div>
      </div>

      <EditDetailsDialog doc={d} open={editing} onClose={() => setEditing(false)} />
      <DeleteRecordDialog doc={d} open={deleting} onClose={() => setDeleting(false)} onDeleted={() => navigate('/records')} />
    </div>
  );
}
