// Medicines, UI spec 7.3. Matches docs/design/CareVault-Medicines.png.
import { Camera, Pill as PillIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { IngredientTotal, Medicine } from '../../contract/legacy/types';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorPanel } from '../components/ErrorPanel';
import { MedicineRow } from '../components/MedicineRow';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { StatTile } from '../components/StatTile';
import { useProfile, useToast } from '../hooks/useContexts';
import { useDeferredResolutions } from '../hooks/useDeferredResolutions';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { pronounsFor, verb } from '../lib/pronouns';
import { ConfirmedTable } from './medicines/ConfirmedTable';
import { DuplicateCard } from './medicines/DuplicateCard';
import { missingFromText, stoppedText } from './medicines/medicineText';
import { OnlyOneDialog } from './medicines/OnlyOneDialog';
import { useMedicineAnswers } from './medicines/useMedicineAnswers';

const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

export function MedicinesScreen() {
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const pronouns = pronounsFor(profile!.relation);
  const toast = useToast();
  const location = useLocation();

  const medicines = useServiceQuery((s) => s.medicines.list(pid), [pid]);
  const totals = useServiceQuery((s) => s.medicines.ingredientTotals(pid), [pid]);
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const summary = useServiceQuery((s) => s.visits.changeSummary(pid), [pid]);
  const confirmedIds = useMemo(
    () => (medicines.data ?? []).filter((m) => m.status === 'confirmed_current').map((m) => m.id),
    [medicines.data],
  );
  const history = useServiceQuery(
    async (s) => Object.fromEntries(await Promise.all(confirmedIds.map(async (id) => [id, await s.medicines.history(id)] as const))),
    [pid, confirmedIds.join()],
    { enabled: confirmedIds.length > 0 },
  );

  const answers = useMedicineAnswers(pid);
  const dupAnswers = useDeferredResolutions();
  const [confirmStop, setConfirmStop] = useState<Medicine | null>(null);
  const [onlyOne, setOnlyOne] = useState<IngredientTotal | null>(null);

  const addQuestion = useServiceAction((s, visitId: string, text: string) => s.visits.addQuestion(visitId, text), {
    success: 'Added to the questions for the doctor',
  });
  const keepOne = useServiceAction(async (s, total: IngredientTotal, keepId: string) => {
    const item = answers.openItems.find(
      (i) => i.kind === 'possible_duplicate' && sameSet(i.medicineIds, total.parts.map((p) => p.medicineId)),
    );
    if (item) return s.review.resolve(item.id, 'only_one', { keepMedicineId: keepId });
    for (const p of total.parts) if (p.medicineId !== keepId) await s.medicines.setStatus(p.medicineId, 'stopped');
  }, { success: 'Saved. The other products are marked as stopped.' });

  // Arriving from "Review both products" (/medicines#possible-duplicates): bring the card into view.
  const dupSection = useRef<HTMLElement>(null);
  const hasTotals = (totals.data?.length ?? 0) > 0;
  useEffect(() => {
    if (location.hash === '#possible-duplicates' && hasTotals && dupSection.current) {
      dupSection.current.scrollIntoView?.({ block: 'start' });
      dupSection.current.focus({ preventScroll: true });
    }
  }, [location.hash, hasTotals]);

  const all = medicines.data ?? [];
  const by = (status: Medicine['status']) => all.filter((m) => m.status === status);
  const needs = by('needs_confirmation').filter((m) => !answers.isHidden(m));
  const atHome = by('found_at_home');
  const confirmed = by('confirmed_current');
  const stopped = by('stopped');

  const askAboutDuplicate = (total: IngredientTotal) => {
    const names = total.parts.map((p) => p.productName);
    const item = answers.openItems.find(
      (i) => i.kind === 'possible_duplicate' && sameSet(i.medicineIds, total.parts.map((p) => p.medicineId)),
    );
    const visit = answers.visit;
    const asked = visit?.questions.some((q) => names.every((n) => q.text.toLowerCase().includes(n.split(' ')[0].toLowerCase())));
    if (asked) {
      toast.show({ message: 'This is already in the questions for the doctor.', tone: 'info' });
      return;
    }
    if (item) {
      dupAnswers.answer(item.id, 'ask_doctor', 'Added to the questions for the doctor');
      return;
    }
    if (!visit) {
      toast.show({ message: 'Plan the next visit first, then add questions for the doctor.', tone: 'error' });
      return;
    }
    void addQuestion.run(
      visit.id,
      `Can ${pronouns.subject} use ${names.join(' and ')} on the same day? ${names.length === 2 ? 'Both' : 'All'} contain ${total.ingredient}.`,
    );
  };

  const header = (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="md:max-w-[640px]">
        <h1 className="text-page-sm md:text-page">Medicines</h1>
        <p className="mt-3 text-ink-2 md:text-[20px] md:leading-[1.5]">
          A medicine counts as current only after you confirm {pronouns.subject} {verb(pronouns, 'take')} it. Being in the house is not
          enough.
        </p>
      </div>
      <div className="shrink-0">
        <Button to="/medicines/scan" cta icon={<Camera aria-hidden className="size-5" />} fullWidth className="md:w-auto">
          Scan a medicine
        </Button>
      </div>
    </header>
  );

  if (medicines.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-card-sm" />
          ))}
        </div>
        <div className="mt-8">
          <SkeletonList count={3} label="Loading medicines" />
        </div>
      </div>
    );
  }

  if (medicines.error) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <ErrorPanel className="mt-8" title="Medicines could not be loaded" message={medicines.error.message} onRetry={medicines.reload} />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <EmptyState
          className="mt-8"
          icon={<PillIcon />}
          title="No medicines yet"
          action={
            <Button to="/medicines/scan" icon={<Camera aria-hidden className="size-5" />}>
              Scan a medicine
            </Button>
          }
        >
          Photograph each pack at home. You confirm every detail before it is saved.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page-gutter py-6 md:py-12">
      {header}

      <div className="mt-8 grid grid-cols-2 gap-3 md:mt-10 md:grid-cols-4 md:gap-4">
        <StatTile size="lg" tone="teal" value={confirmed.length} label="Confirmed current" />
        <StatTile size="lg" tone="amber" value={by('needs_confirmation').length} label="Needs confirmation" />
        <StatTile size="lg" tone="red" value={totals.data?.length ?? 0} label="Possible duplicate" />
        <StatTile size="lg" tone="grey" value={stopped.length} label="Previous or stopped" />
      </div>

      {totals.error ? (
        <ErrorPanel className="mt-8" title="Duplicate check could not be loaded" message={totals.error.message} onRetry={totals.reload} />
      ) : hasTotals ? (
        <section id="possible-duplicates" ref={dupSection} tabIndex={-1} aria-label="Possible duplicate ingredients" className="mt-8 flex scroll-mt-28 flex-col gap-5 outline-none md:mt-10">
          {totals.data!.map((total) => (
            <DuplicateCard
              key={total.ingredient + total.unit}
              total={total}
              medicines={all}
              pronouns={pronouns}
              onAddQuestion={() => askAboutDuplicate(total)}
              addQuestionPending={addQuestion.pending}
              onOnlyOne={() => setOnlyOne(total)}
            />
          ))}
        </section>
      ) : null}

      {needs.length > 0 && (
        <section aria-labelledby="needs-title" className="mt-10 md:mt-14">
          <SectionHeader id="needs-title" title="Needs confirmation" />
          <div className="flex flex-col gap-3">
            {needs.map((m) => (
              <MedicineRow
                key={m.id}
                medicine={m}
                detail={missingFromText(m, prescribers, documents.data ?? []) ?? undefined}
                actions={
                  <>
                    <Button variant="secondary" onClick={() => void answers.answer(m, 'still_taking')} disabled={answers.pending}>
                      Still taking
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmStop(m)} disabled={answers.pending}>
                      Stopped
                    </Button>
                    <Button className="col-span-2" onClick={() => void answers.answer(m, 'ask_doctor')} disabled={answers.pending}>
                      Ask the doctor
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}

      {atHome.length > 0 && (
        <section aria-labelledby="home-title" className="mt-10 md:mt-14">
          <SectionHeader id="home-title" title="Found at home" description={`Scanned at home. Not counted as current until you confirm ${pronouns.subject} ${verb(pronouns, 'take')} it.`} />
          <div className="flex flex-col gap-3">
            {atHome.map((m) => (
              <FoundAtHomeRow key={m.id} medicine={m} label={`Confirm ${pronouns.subject} ${verb(pronouns, 'take')} this`} />
            ))}
          </div>
        </section>
      )}

      {confirmed.length > 0 && (
        <section aria-labelledby="current-title" className="mt-10 md:mt-14">
          <SectionHeader id="current-title" title="Confirmed current" />
          {history.error ? (
            <ErrorPanel title="Changes could not be loaded" message={history.error.message} onRetry={history.reload} />
          ) : (
            <ConfirmedTable medicines={confirmed} prescribers={prescribers} history={history.data} since={summary.data?.since ?? null} />
          )}
        </section>
      )}

      {stopped.length > 0 && (
        <section aria-labelledby="stopped-title" className="mt-10 md:mt-14">
          <SectionHeader id="stopped-title" title="Previous or stopped" />
          <ul className="grid gap-4 md:grid-cols-2">
            {stopped.map((m) => (
              <li key={m.id}>
                <Link to={`/medicines/${m.id}`} className="block rounded-card-sm bg-grey-tint p-[18px] hover:bg-line/60 md:p-6">
                  <span className="block font-semibold text-ink md:text-[18px]">{m.productName}</span>
                  <span className="mt-1 block text-ink-2">{stoppedText(m, all)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={confirmStop !== null}
        title={confirmStop ? `Mark ${confirmStop.productName} as stopped?` : ''}
        message="You can change this later."
        confirmLabel="Mark as stopped"
        onCancel={() => setConfirmStop(null)}
        onConfirm={() => {
          if (confirmStop) void answers.answer(confirmStop, 'stopped');
          setConfirmStop(null);
        }}
      />
      <OnlyOneDialog
        key={onlyOne?.ingredient ?? 'none'}
        total={onlyOne}
        pronouns={pronouns}
        pending={keepOne.pending}
        onCancel={() => setOnlyOne(null)}
        onConfirm={async (keepId) => {
          if (!onlyOne) return;
          await keepOne.run(onlyOne, keepId);
          setOnlyOne(null);
        }}
      />
    </div>
  );
}

function FoundAtHomeRow({ medicine, label }: { medicine: Medicine; label: string }) {
  const confirm = useServiceAction((s, id: string) => s.medicines.confirm(id), {
    success: (m) => `${m.productName} is now a confirmed current medicine`,
  });
  return (
    <MedicineRow
      medicine={medicine}
      actions={
        <Button variant="secondary" className="col-span-2" loading={confirm.pending} onClick={() => void confirm.run(medicine.id)}>
          {label}
        </Button>
      }
    />
  );
}
