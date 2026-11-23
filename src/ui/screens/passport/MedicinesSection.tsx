// The reported routine on the Passport (UI spec 4.8): current medicines, "Current use not confirmed"
// with the batch review of earlier medicines, and "Add a medicine he takes".
import { ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Prescriber, Profile, RoutineMedicine, Visit } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { Pill } from '../../components/Pill';
import { SectionHeader } from '../../components/SectionHeader';
import { useServiceAction } from '../../hooks/useServiceAction';
import { MedicineForm } from './MedicineForm';
import { EMPTY_MEDICINE } from './medicineValues';
import { currentOrder, howTaken, ingredientsText, isSelf, lastConfirmedText, sourceLabel, statusPill, stillTakes, takes, unconfirmedOf } from './passportText';

export interface MedicinesSectionProps {
  profile: Profile;
  routine: RoutineMedicine[];
  visit: Visit | null;
  prescribers: Prescriber[];
}

export function MedicinesSection({ profile, routine, visit, prescribers }: MedicinesSectionProps) {
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<RoutineMedicine | null>(null);
  const current = currentOrder(routine, visit, prescribers);
  const unconfirmed = unconfirmedOf(routine);
  const legacy = unconfirmed.filter((m) => m.legacyReviewPending);
  const prescriberName = (id: string | null) => prescribers.find((p) => p.id === id)?.name ?? null;

  const add = useServiceAction(
    (s, input: Parameters<typeof s.routine.add>[1]) =>
      s.routine.add(profile.id, input, { status: 'taking', source: isSelf(profile) ? 'patient_reported' : 'caregiver_reported', documentId: null }),
    { success: (m) => `${m.productName} added to the current medicines`, errorPrefix: 'The medicine could not be added' },
  );
  // Earlier (legacy) entries are settled through resolveLegacy, so they leave the batch review too.
  const answer = useServiceAction(
    async (s, m: RoutineMedicine, taking: boolean): Promise<unknown> =>
      m.legacyReviewPending
        ? s.routine.resolveLegacy(profile.id, taking ? [m.id] : [], taking ? [] : [m.id])
        : s.routine.setStatus(m.id, taking ? 'taking' : 'stopped'),
    { errorPrefix: 'The answer could not be saved' },
  );

  return (
    <section id="medicines" aria-labelledby="medicines-title" className="flex scroll-mt-24 flex-col gap-6">
      <SectionHeader
        id="medicines-title"
        title="Current medicines"
        aside={current.length === 1 ? '1 taken' : `${current.length} taken`}
        action={
          <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setAdding(true)}>
            Add a medicine {takes(profile)}
          </Button>
        }
      />
      {current.length === 0 ? (
        <Card tone="muted">
          <p className="text-ink-2">No medicines are listed as taken. Add one, or file a prescription and review its changes.</p>
        </Card>
      ) : (
        <ul aria-label="Current medicines" className="grid gap-3 md:grid-cols-2">
          {current.map((m) => (
            <li key={m.id}>
              <Link
                to={`/passport/medicines/${m.id}`}
                className="flex h-full items-start justify-between gap-3 rounded-card-sm border border-line bg-surface p-[18px] shadow-card hover:border-line-strong md:p-5"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink md:text-[18px]">{m.productName}</span>
                  <span className="mt-1 block text-ink-2">{ingredientsText(m)}</span>
                  <span className="mt-1 block text-ink-2">{howTaken(m)}</span>
                  <span className="mt-2 block text-secondary text-ink-3">
                    {[sourceLabel(m, profile), prescriberName(m.prescriberId), lastConfirmedText(m)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {unconfirmed.length > 0 && (
        <section aria-labelledby="unconfirmed-title" className="flex flex-col gap-4">
          <SectionHeader id="unconfirmed-title" level={3} title="Current use not confirmed" description="Listed on the passport as not confirmed. Answer when you know." />
          <ul aria-label="Current use not confirmed" className="flex flex-col gap-3">
            {unconfirmed.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 rounded-card-sm border border-line bg-surface p-[18px] md:flex-row md:items-center md:justify-between md:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/passport/medicines/${m.id}`} className="font-semibold text-ink hover:underline">{m.productName}</Link>
                    <Pill spec={statusPill(m)} />
                  </div>
                  <p className="mt-1 text-secondary text-ink-2">{ingredientsText(m)} · {howTaken(m)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="secondary" aria-label={`${m.productName}: still taking`} onClick={() => void answer.run(m, true)} disabled={answer.pending}>
                    Still taking
                  </Button>
                  <Button size="sm" variant="secondary" aria-label={`${m.productName}: stopped`} onClick={() => setStopping(m)} disabled={answer.pending}>
                    Stopped
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {legacy.length > 0 && <LegacyBatch profile={profile} entries={legacy} />}
        </section>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add a medicine ${takes(profile)}`} description="Typed by you, so it is added as taken. No prescription is needed." size="lg">
        {adding && (
          <MedicineForm
            initial={EMPTY_MEDICINE}
            submitLabel="Add the medicine"
            pending={add.pending}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              if (await add.run(input)) setAdding(false);
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={stopping !== null}
        title={stopping ? `Mark ${stopping.productName} as stopped?` : ''}
        message="It stays in the history. You can change this later."
        confirmLabel="Mark as stopped"
        pending={answer.pending}
        onCancel={() => setStopping(null)}
        onConfirm={async () => {
          if (stopping) await answer.run(stopping, false);
          setStopping(null);
        }}
      />
    </section>
  );
}

/** "Choose the medicines he still takes": settles all earlier entries at once. Never blocks printing. */
function LegacyBatch({ profile, entries }: { profile: Profile; entries: RoutineMedicine[] }) {
  const [taking, setTaking] = useState<Set<string>>(new Set());
  const resolve = useServiceAction(
    (s) => s.routine.resolveLegacy(profile.id, entries.filter((m) => taking.has(m.id)).map((m) => m.id), entries.filter((m) => !taking.has(m.id)).map((m) => m.id)),
    { success: 'The earlier medicines are settled', errorPrefix: 'The answers could not be saved' },
  );
  return (
    <Card as="section" aria-labelledby="legacy-title" tone="muted">
      <h4 id="legacy-title" className="font-sans text-card-sm font-semibold">Choose the medicines {stillTakes(profile)}</h4>
      <p className="mt-2 text-ink-2">
        These came from the earlier version of CareVault. Tick the ones still taken; the others are marked as stopped. Until then they are
        listed as not confirmed, and the passport can still be printed and shared.
      </p>
      <div className="mt-3 flex flex-col">
        {entries.map((m) => (
          <Checkbox
            key={m.id}
            label={m.productName}
            description={`${ingredientsText(m)} · ${howTaken(m)}`}
            checked={taking.has(m.id)}
            onChange={(e) =>
              setTaking((t) => {
                const next = new Set(t);
                if (e.target.checked) next.add(m.id);
                else next.delete(m.id);
                return next;
              })
            }
          />
        ))}
      </div>
      <Button className="mt-4" onClick={() => void resolve.run()} loading={resolve.pending}>
        Save: {taking.size} still taken, {entries.length - taking.size} stopped
      </Button>
    </Card>
  );
}
