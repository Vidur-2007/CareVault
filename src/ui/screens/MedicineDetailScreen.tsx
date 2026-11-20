// Medicine detail, UI spec 7.5: what it is, where it came from, its history, and status actions.
import { Activity, ArrowLeft, CircleCheck, CirclePlus, Flag, PencilLine, Replace, TrendingUp, CircleStop } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { MedicationEvent, Medicine } from '../../contract/legacy/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorPanel } from '../components/ErrorPanel';
import { LineConfirmForm } from '../components/lineForm/LineConfirmForm';
import { ingredientLine } from '../components/lineText';
import { Pill } from '../components/Pill';
import { CHECK_THIS, medicineStatusPill } from '../components/pills';
import { SectionHeader } from '../components/SectionHeader';
import { Sheet } from '../components/Sheet';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { TimelineItem } from '../components/TimelineItem';
import { useProfile } from '../hooks/useContexts';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatDate } from '../lib/format';
import { DOCUMENT_TYPE_LABEL } from '../lib/labels';
import { pronounsFor, verb } from '../lib/pronouns';
import { EVENT_TITLE, dosesText, missingFromText, stoppedText } from './medicines/medicineText';
import { useMedicineAnswers } from './medicines/useMedicineAnswers';

const EVENT_ICON: Record<MedicationEvent['type'], ReactNode> = {
  added: <CirclePlus aria-hidden className="size-5" />,
  confirmed: <CircleCheck aria-hidden className="size-5" />,
  strength_changed: <TrendingUp aria-hidden className="size-5" />,
  instruction_changed: <PencilLine aria-hidden className="size-5" />,
  flagged_for_review: <Flag aria-hidden className="size-5" />,
  marked_stopped: <CircleStop aria-hidden className="size-5" />,
  replaced: <Replace aria-hidden className="size-5" />,
};

export function MedicineDetailScreen() {
  const { id = '' } = useParams();
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const pronouns = pronounsFor(profile!.relation);

  const medicine = useServiceQuery((s) => s.medicines.get(id), [id]);
  const history = useServiceQuery((s) => s.medicines.history(id), [id]);
  const all = useServiceQuery((s) => s.medicines.list(pid), [pid]);
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const answers = useMedicineAnswers(pid);

  const [confirmStop, setConfirmStop] = useState(false);
  const [editing, setEditing] = useState(false);
  const confirm = useServiceAction((s, patch?: Parameters<typeof s.medicines.confirm>[1]) => s.medicines.confirm(id, patch), {
    success: (m) => `${m.productName} is confirmed`,
  });
  const setStatus = useServiceAction((s, status: Medicine['status']) => s.medicines.setStatus(id, status), {
    success: (m) => (m.status === 'stopped' ? `Marked ${m.productName} as stopped` : `${m.productName} is current again`),
  });

  const back = (
    <Link to="/medicines" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Medicines
    </Link>
  );

  if (medicine.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <Skeleton className="mt-4 h-11 w-2/3 max-w-md" />
        <div className="mt-8">
          <SkeletonList count={2} label="Loading the medicine" />
        </div>
      </div>
    );
  }

  if (medicine.error || !medicine.data) {
    const notFound = medicine.error?.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Medicine not found' : 'Medicine'}</h1>
        <ErrorPanel
          className="mt-6"
          title={notFound ? 'This medicine is not in the records' : 'This medicine could not be loaded'}
          message={notFound ? 'It may have been removed, or the link is from another profile.' : medicine.error?.message}
          onRetry={notFound ? undefined : medicine.reload}
        />
      </div>
    );
  }

  const m = medicine.data;
  const prescriber = prescribers.find((p) => p.id === m.prescriberId) ?? null;
  const source = documents.data?.find((d) => d.id === m.sourceDocumentId) ?? null;
  const replacement = all.data?.find((x) => x.id === m.replacedByMedicineId) ?? null;
  const docFor = (docId: string | null) => (docId ? documents.data?.find((d) => d.id === docId) ?? null : null);
  const missing = m.status === 'needs_confirmation' ? missingFromText(m, prescribers, documents.data ?? []) : null;
  const takesIt = `${pronouns.subject} ${verb(pronouns, 'take')}`;
  const hidden = answers.isHidden(m);

  let actions: ReactNode = null;
  if (m.status === 'found_at_home') {
    actions = (
      <>
        <Button onClick={() => void confirm.run()} loading={confirm.pending}>
          Confirm {takesIt} this
        </Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Check the details
        </Button>
        <Button variant="secondary" onClick={() => setConfirmStop(true)}>
          Mark as stopped
        </Button>
      </>
    );
  } else if (m.status === 'needs_confirmation' && !hidden) {
    actions = (
      <>
        <Button variant="secondary" onClick={() => void answers.answer(m, 'still_taking')} disabled={answers.pending}>
          Still taking
        </Button>
        <Button variant="secondary" onClick={() => setConfirmStop(true)} disabled={answers.pending}>
          Stopped
        </Button>
        <Button onClick={() => void answers.answer(m, 'ask_doctor')} disabled={answers.pending}>
          Ask the doctor
        </Button>
      </>
    );
  } else if (m.status === 'confirmed_current') {
    actions = (
      <>
        <Button variant="secondary" icon={<PencilLine aria-hidden className="size-5" />} onClick={() => setEditing(true)}>
          Edit details
        </Button>
        <Button variant="secondary" onClick={() => setConfirmStop(true)}>
          Mark as stopped
        </Button>
      </>
    );
  } else if (m.status === 'stopped' && !replacement) {
    actions = (
      <Button variant="secondary" onClick={() => void setStatus.run('confirmed_current')} loading={setStatus.pending}>
        {pronouns.subject === 'they' ? 'They take' : `${pronouns.subject[0].toUpperCase()}${pronouns.subject.slice(1)} takes`} it again
      </Button>
    );
  }

  const events = [...(history.data ?? [])].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <header className="mt-2">
        <h1 className="text-page-sm md:text-page">{m.productName}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill spec={medicineStatusPill(m)} />
          {m.fieldState === 'extracted' && <Pill spec={CHECK_THIS} />}
        </div>
      </header>

      <div className="mt-8 grid gap-6 wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] wide:gap-8">
        <Card as="section" aria-labelledby="details-title">
          <h2 id="details-title" className="sr-only">
            Details
          </h2>
          <dl className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-secondary font-semibold text-ink-3">Ingredients</dt>
            <dd className="text-ink">{ingredientLine(m.ingredients)}</dd>
            <dt className="text-secondary font-semibold text-ink-3">How it is taken</dt>
            <dd className="text-ink">{m.instruction || 'Not entered'}</dd>
            <dt className="text-secondary font-semibold text-ink-3">How many per day</dt>
            <dd className="text-ink">{dosesText(m).replace('Entered: ', '').replace('How often: ', '')}</dd>
            <dt className="text-secondary font-semibold text-ink-3">Prescribed by</dt>
            <dd className="text-ink">{prescriber ? `${prescriber.name}, ${prescriber.specialty.toLowerCase()}` : 'Not from a prescription'}</dd>
            <dt className="text-secondary font-semibold text-ink-3">Source</dt>
            <dd>
              {source ? (
                <Link to={`/records/${source.id}`} className="font-semibold text-teal underline decoration-2 underline-offset-4 hover:text-teal-ink">
                  {source.title}, {formatDate(source.documentDate)}
                </Link>
              ) : (
                <span className="text-ink">{m.origin === 'manual' ? 'Entered by hand' : 'No document kept'}</span>
              )}
            </dd>
          </dl>
          {m.status === 'stopped' && (
            <p className="mt-5 rounded-panel bg-grey-tint px-4 py-3 text-ink-2">
              {stoppedText(m, all.data ?? [])}
              {replacement && (
                <>
                  {' '}
                  <Link to={`/medicines/${replacement.id}`} className="font-semibold text-teal underline underline-offset-4">
                    Open {replacement.productName}
                  </Link>
                </>
              )}
            </p>
          )}
          {missing && <p className="mt-5 rounded-panel bg-amber-tint px-4 py-3 text-amber-ink">This medicine is {missing}. CareVault does not assume it was stopped.</p>}
          {hidden && <p className="mt-5 rounded-panel bg-teal-tint px-4 py-3 text-teal-ink">Your answer is being saved.</p>}
          {actions && <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions}</div>}
        </Card>

        <section aria-labelledby="history-title">
          <SectionHeader id="history-title" title="History" level={2} />
          {history.loading ? (
            <SkeletonList count={2} lines={1} label="Loading the history" />
          ) : history.error ? (
            <ErrorPanel title="The history could not be loaded" message={history.error.message} onRetry={history.reload} />
          ) : events.length === 0 ? (
            <p className="text-ink-3">No history yet.</p>
          ) : (
            <ol>
              {events.map((e, i) => {
                const doc = docFor(e.documentId);
                return (
                  <TimelineItem
                    key={e.id}
                    date={formatDate(e.at)}
                    title={EVENT_TITLE[e.type]}
                    icon={EVENT_ICON[e.type] ?? <Activity aria-hidden className="size-5" />}
                    detail={
                      <>
                        {e.detail}
                        {doc && (
                          <>
                            {e.detail ? ' · ' : ''}
                            <Link to={`/records/${doc.id}`} className="font-semibold text-teal underline underline-offset-4">
                              {DOCUMENT_TYPE_LABEL[doc.type]}, {formatDate(doc.documentDate)}
                            </Link>
                          </>
                        )}
                      </>
                    }
                    last={i === events.length - 1}
                  />
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmStop}
        title={`Mark ${m.productName} as stopped?`}
        message="You can change this later."
        confirmLabel="Mark as stopped"
        pending={setStatus.pending}
        onCancel={() => setConfirmStop(false)}
        onConfirm={async () => {
          if (m.status === 'needs_confirmation') {
            setConfirmStop(false);
            void answers.answer(m, 'stopped');
            return;
          }
          await setStatus.run('stopped');
          setConfirmStop(false);
        }}
      />

      <Sheet open={editing} onClose={() => setEditing(false)} title={m.status === 'found_at_home' ? 'Check the details' : 'Edit details'}>
        <LineConfirmForm
          source={undefined}
          line={{ ...m, warnings: [] }}
          fromExtraction={m.fieldState === 'extracted'}
          pendingAction={confirm.pending ? 'save' : null}
          actions={[{ id: 'save', label: m.status === 'found_at_home' ? `Save and confirm ${takesIt} it` : 'Save changes' }]}
          onSubmit={async (line) => {
            const saved = await confirm.run({
              productName: line.productName,
              ingredients: line.ingredients,
              form: line.form,
              dosesPerDay: line.dosesPerDay,
              instruction: line.instruction,
            });
            if (saved) setEditing(false);
          }}
        />
      </Sheet>
    </div>
  );
}
