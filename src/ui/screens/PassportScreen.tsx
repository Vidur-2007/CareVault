// Passport, UI spec 4.8: the live passport, plus the reported routine, which is edited here.
// Print and Share with QR (4.11) always go through a snapshot, created or reused first.
import { History, Printer, QrCode as QrIcon, Save } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useProfile, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { CHANGE_LABEL, changeText } from '../lib/changes';
import { ageFrom, formatDate } from '../lib/format';
import { ActiveLinks } from './passport/ActiveLinks';
import { DuplicateCard } from './passport/DuplicateCard';
import { HealthSection } from './passport/HealthSection';
import { MedicinesSection } from './passport/MedicinesSection';
import { snapshotLine } from './passport/passportText';
import { isActive } from './passport/shareLinks';
import { usePassportOutputs } from './passport/usePassportOutputs';
import { VisitSection } from './passport/VisitSection';

const RECENT_TONE = { started: 'blue', changed: 'amber', stopped: 'grey', not_started: 'grey' } as const;

export function PassportScreen() {
  useDocumentTitle('Passport');
  const { profile, prescribers, today } = useProfile();
  const toast = useToast();
  const p = profile!;
  const pid = p.id;

  const routine = useServiceQuery((s) => s.routine.list(pid), [pid]);
  const totals = useServiceQuery((s) => s.routine.ingredientTotals(pid), [pid]);
  const health = useServiceQuery((s) => s.health.list(pid), [pid]);
  const visit = useServiceQuery((s) => s.visits.next(pid), [pid]);
  const live = useServiceQuery((s) => s.passport.live(pid), [pid]);
  const snapshots = useServiceQuery((s) => s.passport.snapshots(pid), [pid]);
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const links = useServiceQuery((s) => s.sharing.list(pid), [pid]);
  const outputs = usePassportOutputs({ profileId: pid });

  const save = useServiceAction((s) => s.passport.snapshot(pid, 'manual'), { errorPrefix: 'The snapshot could not be saved' });

  const age = ageFrom(p.birthYear, today);
  const loading = routine.loading || health.loading || visit.loading;

  // "/passport#questions" and "/passport#medicines" (from Ask) open at that section once it is shown.
  const { hash } = useLocation();
  useEffect(() => {
    if (loading || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.({ block: 'start' });
  }, [loading, hash]);
  const error = routine.error ?? health.error ?? visit.error;

  const header = (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-page-sm md:text-page">Passport</h1>
        <p className="mt-3 text-[18px] text-ink md:text-[20px]">
          <span className="font-semibold">{p.name}</span>
          {age !== null && <span className="text-ink-2"> · {age} years</span>}
          <span className="text-ink-2"> · {p.relation}</span>
        </p>
        <p className="mt-1 text-ink-2">
          Emergency contact: {p.emergencyContact ?? 'not added'}
          {p.caregiverName && <> · Prepared by {p.caregiverName}{p.caregiverRelation ? `, ${p.caregiverRelation}` : ''}</>}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button icon={<Printer aria-hidden className="size-5" />} onClick={() => void outputs.print()} loading={outputs.pending}>
          Print
        </Button>
        <Button variant="secondary" icon={<QrIcon aria-hidden className="size-5" />} onClick={() => void outputs.share()}>
          Share with QR
        </Button>
        <Button
          variant="secondary"
          icon={<Save aria-hidden className="size-5" />}
          loading={save.pending}
          onClick={async () => {
            const before = snapshots.data?.[0]?.id;
            const snapshot = await save.run();
            if (!snapshot) return;
            toast.show({
              message: snapshot.id === before ? `Nothing changed since passport ${snapshot.revision}. It is kept as it is.` : `Saved as passport ${snapshot.revision}`,
              tone: 'success',
            });
          }}
        >
          Save a snapshot
        </Button>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <Skeleton className="mt-8 h-32 w-full rounded-card" />
        <div className="mt-6"><SkeletonList count={3} label="Loading the passport" /></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <ErrorPanel className="mt-8" title="The passport could not be loaded" message={error.message} onRetry={() => { routine.reload(); health.reload(); visit.reload(); }} />
      </div>
    );
  }

  const meds = routine.data ?? [];
  const recent = live.data?.recentChanges ?? [];

  return (
    <div className="page-gutter py-6 md:py-12">
      {header}
      <div className="mt-8 grid gap-8 wide:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <MedicinesSection profile={p} routine={meds} visit={visit.data ?? null} prescribers={prescribers} />

          {(totals.data ?? []).length > 0 && (
            <section aria-labelledby="duplicates-title" className="flex flex-col gap-4">
              <SectionHeader id="duplicates-title" title="Possible duplicate ingredients" />
              {totals.data!.map((t) => <DuplicateCard key={t.ingredient} total={t} medicines={meds} />)}
            </section>
          )}

          <HealthSection profile={p} health={health.data ?? []} />

          <section aria-labelledby="recent-title" className="flex flex-col gap-4">
            <SectionHeader id="recent-title" title="Recent changes" description="From the routine history of the last 90 days, by the date they were recorded." />
            {live.loading ? <SkeletonList count={1} label="Loading recent changes" /> : recent.length === 0 ? (
              <p className="text-ink-2">No changes in the last 90 days.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recent.map((c, i) => (
                  <li key={`${c.on}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-panel bg-surface px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2 text-ink"><Pill tone={RECENT_TONE[c.kind]}>{CHANGE_LABEL[c.kind]}</Pill>{changeText(c)}</span>
                    <span className="text-secondary text-ink-3">{formatDate(c.on)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="Visit and earlier passports">
          <VisitSection profile={p} visit={visit.data ?? null} prescribers={prescribers} documents={documents.data ?? []} />
          <ActiveLinks
            links={(links.data ?? []).filter((l) => isActive(l))}
            labelFor={(id) => {
              const r = snapshots.data?.find((x) => x.id === id)?.revision;
              return r ? `Passport ${r}` : 'Passport';
            }}
            onChanged={links.reload}
          />
          <Card as="section" aria-labelledby="earlier-title">
            <h2 id="earlier-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
              <History aria-hidden className="size-5 text-ink-3" />
              Earlier passports
            </h2>
            {snapshots.loading ? <SkeletonList count={1} label="Loading earlier passports" /> : (snapshots.data ?? []).length === 0 ? (
              <p className="mt-3 text-ink-2">None yet. A copy is saved each time the passport is printed, shared or saved.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1">
                {snapshots.data!.map((s) => (
                  <li key={s.id}>
                    <Link to={`/passport/snapshots/${s.id}`} className="flex min-h-11 items-center rounded-button px-2 text-teal-ink hover:bg-teal-tint">
                      {snapshotLine(s)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {outputs.dialog}
    </div>
  );
}
