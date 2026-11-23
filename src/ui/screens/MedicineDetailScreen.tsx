// Medicine detail, UI spec 4.9: the entry's fields, source, prescriber and source record, its
// history with before and after values, and edit, set status and Undo on the latest event.
import { ArrowLeft, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { RoutineStatus } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SkeletonList } from '../components/Skeleton';
import { toServiceError } from '../hooks/toServiceError';
import { useProfile, useServices, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatDate } from '../lib/format';
import { MedicineForm } from './passport/MedicineForm';
import { valuesFrom } from './passport/medicineValues';
import { eventChanges, eventLabel, howTaken, ingredientsText, lastConfirmedText, sourceLabel, statusPill, undoable } from './passport/passportText';

const STATUS_CHOICES: { status: RoutineStatus; label: string; confirm?: string }[] = [
  { status: 'taking', label: 'Taking' },
  { status: 'uncertain', label: 'Not sure' },
  { status: 'not_started', label: 'Not started', confirm: 'It is kept for reference and not listed as current.' },
  { status: 'stopped', label: 'Stopped', confirm: 'It stays in the history. You can change this later.' },
];

export function MedicineDetailScreen() {
  const { id = '' } = useParams();
  const { profile, prescribers } = useProfile();
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<(typeof STATUS_CHOICES)[number] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoRefused, setUndoRefused] = useState(false);

  const med = useServiceQuery((s) => s.routine.get(id), [id]);
  const mine = med.data && med.data.profileId === profile!.id ? med.data : null;
  const history = useServiceQuery((s) => s.routine.history(id), [id], { enabled: mine !== null });
  const sourceDoc = useServiceQuery((s) => s.documents.get(mine!.sourceDocumentId!), [mine?.sourceDocumentId], { enabled: !!mine?.sourceDocumentId });
  const replacement = useServiceQuery((s) => s.routine.get(mine!.replacedByMedicineId!), [mine?.replacedByMedicineId], { enabled: !!mine?.replacedByMedicineId });
  useDocumentTitle(mine?.productName ?? 'Medicine');

  const update = useServiceAction((s, input: Parameters<typeof s.routine.update>[1]) => s.routine.update(id, input), {
    success: 'Changes saved', errorPrefix: 'The changes could not be saved',
  });
  const setStatus = useServiceAction((s, status: RoutineStatus) => s.routine.setStatus(id, status), {
    success: (m) => `Marked as ${statusPill(m).label.toLowerCase()}`, errorPrefix: 'The status could not be changed',
  });

  const back = (
    <Link to="/passport" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Passport
    </Link>
  );

  if (med.loading) return <div className="page-gutter py-6 md:py-12">{back}<div className="mt-8"><SkeletonList count={2} label="Loading the medicine" /></div></div>;
  if (!mine) {
    const notFound = !med.error || med.error.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Medicine not found' : 'Medicine'}</h1>
        <ErrorPanel className="mt-6" title={notFound ? 'This medicine is not in the routine' : 'This medicine could not be loaded'} message={notFound ? 'It may have been removed by an Undo, or the link is for another profile.' : med.error?.message} onRetry={notFound ? undefined : med.reload} />
      </div>
    );
  }

  const m = mine;
  const events = history.data ?? [];
  const latest = undoable(events);
  const prescriber = prescribers.find((p) => p.id === m.prescriberId);
  const sourceGone = sourceDoc.error?.code === 'not_found';

  const undo = async () => {
    if (!latest) return;
    setUndoing(true);
    setUndoRefused(false);
    try {
      await services.routine.undo(latest.id);
      toast.show({ message: `Undone: ${latest.detail}`, tone: 'success' });
      if (latest.before === null) navigate('/passport'); // the entry was created by that event, so it is gone
    } catch (err) {
      const e = toServiceError(err);
      if (e.code === 'stale') setUndoRefused(true);
      else toast.show({ message: e.message, tone: 'error' });
    } finally {
      setUndoing(false);
    }
  };

  const rows: [string, ReactNode][] = [
    ['Active ingredients', ingredientsText(m)],
    ['How it is taken', howTaken(m)],
    ['Doses a day', m.dosesPerDay === null ? 'Not entered' : String(m.dosesPerDay)],
    ['Source', sourceLabel(m, profile!)],
    ['Doctor', prescriber ? [prescriber.name, prescriber.specialty].filter(Boolean).join(', ') : 'No doctor'],
    ['Source record', !m.sourceDocumentId ? 'None' : sourceGone ? 'The source record was removed' : sourceDoc.data ? <Link to={`/records/${m.sourceDocumentId}`} className="font-semibold text-teal underline underline-offset-4">{sourceDoc.data.title}{sourceDoc.data.clinicalDate ? `, ${formatDate(sourceDoc.data.clinicalDate)}` : ''}</Link> : '…'],
    ['Last confirmed', lastConfirmedText(m).replace('Last confirmed ', '')],
    ...(m.replacedByMedicineId ? [['Replaced by', replacement.data ? <Link to={`/passport/medicines/${m.replacedByMedicineId}`} className="font-semibold text-teal underline underline-offset-4">{replacement.data.productName}</Link> : 'A newer entry'] as [string, ReactNode]] : []),
  ];

  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-page-sm md:text-page">{m.productName}</h1>
          <div className="mt-3 flex flex-wrap gap-2"><Pill spec={statusPill(m)} /></div>
        </div>
        <Button variant="secondary" icon={<Pencil aria-hidden className="size-5" />} onClick={() => setEditing(true)}>Edit</Button>
      </header>

      <div className="mt-8 grid gap-6 wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] wide:gap-8">
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="med-details-title">
            <h2 id="med-details-title" className="font-sans text-card-sm font-semibold">Details</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-secondary font-semibold text-ink-3">{label}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card as="section" aria-labelledby="status-title">
            <h2 id="status-title" className="font-sans text-card-sm font-semibold">What is true now?</h2>
            <p className="mt-2 text-ink-2">This records what is taken. It is not advice to start or stop a medicine.</p>
            <div role="group" aria-label="Status" className="mt-4 flex flex-wrap gap-2">
              {STATUS_CHOICES.map((c) => (
                <Button
                  key={c.status}
                  size="sm"
                  variant={m.status === c.status ? 'primary' : 'secondary'}
                  aria-pressed={m.status === c.status}
                  disabled={setStatus.pending}
                  onClick={() => {
                    if (m.status === c.status) return;
                    if (c.confirm) setConfirming(c);
                    else void setStatus.run(c.status);
                  }}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </Card>
        </div>

        <section aria-labelledby="history-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="history-title" className="font-sans text-card-sm font-semibold md:text-card">History</h2>
            {latest && (
              <Button size="sm" variant="secondary" icon={<Undo2 aria-hidden className="size-4" />} loading={undoing} onClick={() => void undo()}>
                Undo the latest change
              </Button>
            )}
          </div>
          {undoRefused && (
            <p role="alert" className="rounded-panel bg-amber-tint px-4 py-3 font-semibold text-amber-ink">A later change was made; see the history.</p>
          )}
          {history.loading ? <SkeletonList count={2} label="Loading the history" /> : (
            <ol aria-label="History, newest first" className="flex flex-col gap-3">
              {[...events].reverse().map((e) => {
                const changes = eventChanges(e);
                return (
                  <li key={e.id} className="rounded-panel border border-line bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{eventLabel(e)}</span>
                      <span className="text-secondary text-ink-3">{formatDate(e.at)}</span>
                    </div>
                    {e.detail && <p className="mt-1 text-ink-2">{e.detail}</p>}
                    {changes.length > 0 && (
                      <table className="mt-2 w-full text-secondary">
                        <caption className="sr-only">Before and after</caption>
                        <thead><tr className="text-left text-ink-3"><th scope="col" className="font-semibold">Field</th><th scope="col" className="font-semibold">Before</th><th scope="col" className="font-semibold">After</th></tr></thead>
                        <tbody>
                          {changes.map((c) => (
                            <tr key={c.label}><th scope="row" className="pr-3 text-left font-normal text-ink-3">{c.label}</th><td className="pr-3 text-ink-2">{c.before}</td><td className="text-ink">{c.after}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${m.productName}`} description="The change is recorded in the history." size="lg">
        {editing && (
          <MedicineForm
            initial={valuesFrom(m)}
            submitLabel="Save the changes"
            pending={update.pending}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              if (await update.run(input)) setEditing(false);
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Mark ${m.productName} as ${confirming.label.toLowerCase()}?` : ''}
        message={confirming?.confirm}
        confirmLabel={confirming ? `Mark as ${confirming.label.toLowerCase()}` : 'Confirm'}
        pending={setStatus.pending}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming) await setStatus.run(confirming.status);
          setConfirming(null);
        }}
      />
    </div>
  );
}
