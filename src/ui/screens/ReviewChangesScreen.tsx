// Review changes, UI spec 4.7 (overview 9.3): one card per asked row, choices held on screen and
// sent together with the routine revision, confirmation before anything is marked stopped, stale
// handling that keeps the choices that still apply, Not now, and a summary with Undo per change.
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ProposalChoice, ProposalRow, RoutineProposal, RowDecision } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorPanel } from '../components/ErrorPanel';
import { SkeletonList } from '../components/Skeleton';
import { useProfile, useServices, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { toServiceError } from '../hooks/toServiceError';
import { formatDate } from '../lib/format';
import { ReviewRowCard } from './review/ReviewRowCard';
import { ReviewSummary, type SummaryItem } from './review/ReviewSummary';
import {
  answeredRows, choiceLabel, eventsForRow, offeredRows, passiveLine, questionsForRows, reconcile, rowKey, rowName,
  sameLine, stopConfirmation, summarySentence, voiceFor,
} from './review/reviewText';
import { useHeldChoices } from './review/useHeldChoices';

const STALE_TEXT = 'The routine changed since this review was prepared. It has been refreshed, and your choices are kept where they still apply.';
/** Choices asked about first (UI spec 4.7): "He has stopped" and "He is not taking it". */
const CONFIRM_FIRST: ProposalChoice[] = ['not_taking'];

export function ReviewChangesScreen() {
  useDocumentTitle('Review changes');
  const { id = '' } = useParams();
  const { profile, prescribers } = useProfile();
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const p = profile!;

  const doc = useServiceQuery((s) => s.documents.get(id), [id]);
  const mine = doc.data && doc.data.profileId === p.id ? doc.data : null;
  const proposal = useServiceQuery((s) => s.routine.proposalFor(id), [id], { enabled: mine !== null });
  const fields = useServiceQuery((s) => s.documents.fields(id), [id], { enabled: mine !== null });

  const { held, choose, forget } = useHeldChoices(id);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ row: ProposalRow; choice: ProposalChoice } | null>(null);
  // The proposal returned by decide, shown until the reloaded one arrives, so the cards just answered
  // never reappear for a moment. `base` is the query result it replaces.
  const [fromSave, setFromSave] = useState<{ proposal: RoutineProposal; base: RoutineProposal | null | undefined } | null>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const staleBanner = useRef<HTMLDivElement>(null);
  const saved = summary.length > 0;

  useEffect(() => {
    if (saved) summaryHeading.current?.focus();
  }, [saved]);
  useEffect(() => {
    if (stale) staleBanner.current?.focus();
  }, [stale]);

  const voice = voiceFor(p);
  const reviewHref = `/records/${id}/review`;
  const verifyHref = `/records/${id}/verify?return=${encodeURIComponent(reviewHref)}`;

  const back = (
    <Link to={`/records/${id}`} className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Back to the record
    </Link>
  );
  const frame = (body: ReactNode, subtitle?: ReactNode) => (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <h1 className="mt-2 text-page-sm md:text-page">What changed on this prescription</h1>
      {subtitle && <p className="mt-3 max-w-2xl text-[18px] text-ink-2">{subtitle}</p>}
      <div className="mt-8 flex max-w-3xl flex-col gap-6">{body}</div>
    </div>
  );

  if (doc.loading || (mine && proposal.loading)) return frame(<SkeletonList count={3} label="Loading the review" />);
  if (!mine) {
    const notFound = !doc.error || doc.error.code === 'not_found';
    return frame(
      <ErrorPanel
        title={notFound ? 'This record is not in these records' : 'This record could not be loaded'}
        message={notFound ? 'It may have been deleted, or the link is for another profile.' : doc.error?.message}
        onRetry={notFound ? undefined : doc.reload}
      />,
    );
  }
  if (proposal.error) {
    return frame(<ErrorPanel title="The review could not be loaded" message={proposal.error.message} onRetry={proposal.reload} />);
  }

  const prescriber = prescribers.find((x) => x.id === (proposal.data?.prescriberId ?? mine.prescriberId));
  const subtitle = `${[prescriber?.name, mine.clinicalDate ? formatDate(mine.clinicalDate) : 'Date not known'].filter(Boolean).join(' · ')}. Nothing changes until you choose.`;

  const pr = fromSave && fromSave.base === proposal.data ? fromSave.proposal : proposal.data;
  if (!pr) {
    return frame(
      <EmptyState icon={<CircleCheck aria-hidden />} title="No differences with the current routine" action={<Button to={`/records/${id}`}>Back to the record</Button>}>
        Every medicine on this prescription matches the routine, or no medicines have been saved from it.
      </EmptyState>,
      subtitle,
    );
  }

  const offered = offeredRows(pr.rows, !saved);
  const earlier = saved ? [] : answeredRows(pr.rows);
  const same = pr.rows.filter((r) => r.kind === 'same');
  const { kept, dropped } = reconcile(held, offered);
  const flaggedFor = (row: ProposalRow) =>
    (fields.data ?? []).filter((e) => e.lineIndex === row.line?.lineIndex && (e.status === 'needs_verification' || e.status === 'unknown'));

  const pick = (row: ProposalRow, choice: ProposalChoice) => {
    setSaveError(null);
    if (CONFIRM_FIRST.includes(choice)) setConfirming({ row, choice });
    else choose(rowKey(row), { choice, name: row.medicine?.productName ?? row.line?.productName ?? rowName(row) });
  };

  async function save() {
    const current = pr!;
    // Sent together, in the order of the cards.
    const decisions: RowDecision[] = offered.filter((r) => kept.has(r.id)).map((r) => ({ rowId: r.id, choice: kept.get(r.id)! }));
    if (decisions.length === 0) {
      setSaveError('Choose an answer for at least one medicine, or choose Not now.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const before = new Set((await services.routine.profileHistory(p.id)).map((e) => e.id));
      const result = await services.routine.decide(current.id, decisions, current.routineRevision);
      const created = (await services.routine.profileHistory(p.id)).filter((e) => !before.has(e.id) && e.proposalId === current.id);
      const answered = decisions.map((d) => ({ row: current.rows.find((r) => r.id === d.rowId)!, choice: d.choice }));
      const questions = questionsForRows(answered, result.questionsAdded);
      setSummary((s) => [
        ...s,
        ...answered.map(({ row, choice }): SummaryItem => {
          const events = choice === 'same_medicine' || choice === 'different_medicine' ? [] : eventsForRow(row, created, id);
          return {
            id: `${row.id}-${s.length}`,
            text: summarySentence(row, choice, questions.has(row.id)),
            events,
            questions: questions.get(row.id) ?? [],
            medicineId: row.medicine?.id ?? events[0]?.medicineId ?? null,
            state: 'done',
          };
        }),
      ]);
      setFromSave({ proposal: result.proposal, base: proposal.data });
      setStale(false);
      forget();
      proposal.reload();
    } catch (err) {
      const e = toServiceError(err);
      if (e.code === 'stale') {
        setStale(true);
        proposal.reload();
      } else if (e.code === 'verification_required') {
        // Never write an unverified value: send the user to the check, and back here.
        toast.show({ message: e.message, tone: 'error' });
        navigate(verifyHref);
      } else {
        setSaveError(`The choices could not be saved. ${e.message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function undo(item: SummaryItem) {
    const set = (patch: Partial<SummaryItem>) => setSummary((s) => s.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    set({ state: 'undoing' });
    try {
      for (const e of item.events) await services.routine.undo(e.id);
      if (item.questions.length) {
        const visit = await services.visits.next(p.id);
        if (visit) for (const q of item.questions) if (visit.questions.some((x) => x.id === q.id)) await services.visits.removeQuestion(visit.id, q.id);
      }
      set({ state: 'undone' });
      toast.show({ message: `Undone: ${item.text}`, tone: 'success' });
      proposal.reload();
    } catch (err) {
      const e = toServiceError(err);
      set({ state: 'refused', message: e.code === 'stale' ? 'A later change was made; see the history.' : e.message });
    }
  }

  async function notNow() {
    setDismissing(true);
    try {
      await services.routine.dismiss(pr!.id);
      forget();
      toast.show({ message: 'Review put off. You can open it again from the record.', tone: 'success' });
      navigate(`/records/${id}`);
    } catch (err) {
      setSaveError(`The review could not be put off. ${toServiceError(err).message}`);
      setDismissing(false);
    }
  }

  const answeredCount = offered.filter((r) => kept.has(r.id)).length;

  return frame(
    <>
      {stale && (
        <div ref={staleBanner} tabIndex={-1} role="alert" className="rounded-panel border border-amber-ink/50 bg-amber-tint p-4 text-ink outline-none">
          <p className="font-semibold">{STALE_TEXT}</p>
          {dropped.length > 0 && <p className="mt-1 text-ink-2">Choose again for {dropped.join(', ')}: {dropped.length === 1 ? 'it' : 'they'} changed.</p>}
        </div>
      )}

      {saved && <ReviewSummary ref={summaryHeading} items={summary} onUndo={(item) => void undo(item)} />}

      {earlier.length > 0 && (
        <Card tone="muted" as="section" aria-labelledby="answered-title">
          <h2 id="answered-title" className="font-sans text-card-sm font-semibold">Answered earlier</h2>
          <ul className="mt-3 flex flex-col gap-1 text-ink">
            {earlier.map((r) => <li key={r.id}>{rowName(r)}: {choiceLabel(r, r.decision!, voice)}</li>)}
          </ul>
        </Card>
      )}

      {offered.length > 0 && (
        <section aria-label={saved ? 'Still to answer' : 'Medicines to review'} className="flex flex-col gap-5">
          {saved && <h2 className="font-sans text-card-sm font-semibold">Still to answer</h2>}
          {offered.map((row) => (
            <ReviewRowCard
              key={row.id}
              row={row}
              voice={voice}
              chosen={kept.get(row.id) ?? null}
              onChoose={(c) => pick(row, c)}
              flagged={flaggedFor(row)}
              verifyHref={verifyHref}
            />
          ))}
        </section>
      )}

      {(same.length > 0 || pr.passiveNotMentionedCount > 0) && (
        <div className="flex flex-col gap-2">
          {same.length > 0 && (
            <p className="rounded-panel bg-surface px-4 py-3 text-ink">
              <span className="block">{sameLine(same.length)}</span>
              <span className="block text-secondary text-ink-3">{same.map((r) => r.line?.productName ?? r.medicine?.productName).join(', ')}</span>
            </p>
          )}
          {pr.passiveNotMentionedCount > 0 && <p className="rounded-panel bg-surface px-4 py-3 text-ink">{passiveLine(pr.passiveNotMentionedCount)}</p>}
        </div>
      )}

      {offered.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-line pt-6">
          <p className="text-ink-2" aria-live="polite">
            {answeredCount} of {offered.length} answered. Medicines without an answer stay as they are.
          </p>
          {saveError && <p role="alert" className="font-semibold text-red-ink">{saveError}</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void save()} loading={saving} disabled={dismissing}>Save these choices</Button>
            <Button variant="secondary" onClick={() => void notNow()} loading={dismissing} disabled={saving}>Not now</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          {!saved && <p className="text-ink-2">Every medicine on this prescription has an answer.</p>}
          <Button to={`/records/${id}`}>Back to the record</Button>
          <Button variant="secondary" to="/passport">Open the passport</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? stopConfirmation(confirming.row).title : ''}
        message={confirming ? stopConfirmation(confirming.row).message : undefined}
        confirmLabel={confirming ? stopConfirmation(confirming.row).confirm : 'Confirm'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const c = confirming!;
          choose(rowKey(c.row), { choice: c.choice, name: c.row.medicine?.productName ?? c.row.line?.productName ?? rowName(c.row) });
          setConfirming(null);
        }}
      />
    </>,
    subtitle,
  );
}
