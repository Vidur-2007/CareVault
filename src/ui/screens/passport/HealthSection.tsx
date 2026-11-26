// Allergies and history on the Passport (UI spec 4.8, overview 9.4). Allergies have three states:
// listed, "No known allergies" (one explicit entry) and "Not recorded" (no allergy entry at all).
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { HealthEntry, HealthEntryKind, Profile } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { Pill } from '../../components/Pill';
import { SectionHeader } from '../../components/SectionHeader';
import { useServiceAction } from '../../hooks/useServiceAction';
import { allergyState, isSelf } from './passportText';

const LABEL: Record<Exclude<HealthEntryKind, 'note'>, { title: string; one: string; hint: string; empty: string }> = {
  allergy: { title: 'Allergies', one: 'allergy', hint: 'The substance and what happens, for example "Penicillin: rash".', empty: '' },
  condition: { title: 'Conditions', one: 'condition', hint: 'For example "High blood pressure".', empty: 'No conditions recorded.' },
  procedure: { title: 'Procedures', one: 'procedure', hint: 'An operation or procedure, with the year if known.', empty: 'No procedures recorded.' },
};

export function HealthSection({ profile, health }: { profile: Profile; health: HealthEntry[] }) {
  const source = isSelf(profile) ? 'patient_reported' : 'caregiver_reported';
  const add = useServiceAction(
    (s, kind: HealthEntryKind, text: string, noneKnown: boolean) =>
      s.health.add(profile.id, { kind, text, noneKnown, source, documentId: null }),
    { errorPrefix: 'It could not be saved' },
  );
  const remove = useServiceAction((s, id: string) => s.health.remove(id), { errorPrefix: 'It could not be removed' });
  const allergies = allergyState(health);

  return (
    <section aria-labelledby="health-title" className="flex flex-col gap-4">
      <SectionHeader id="health-title" title="Allergies and history" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card as="section" aria-labelledby="allergies-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="allergies-title" className="font-sans text-card-sm font-semibold">Allergies</h3>
            {allergies.state === 'listed' ? <Pill tone="red">{allergies.items.length === 1 ? '1 allergy' : `${allergies.items.length} allergies`}</Pill>
              : allergies.state === 'none_known' ? <Pill tone="teal">No known allergies</Pill>
                : <Pill tone="amber">Not recorded</Pill>}
          </div>
          {allergies.state === 'listed' && <EntryList entries={allergies.items} onRemove={(id) => void remove.run(id)} pending={remove.pending} />}
          {allergies.state === 'none_known' && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink">No known allergies</p>
              <Button size="sm" variant="quiet" onClick={() => void remove.run(allergies.entry.id)} disabled={remove.pending}>Undo</Button>
            </div>
          )}
          {allergies.state === 'not_recorded' && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-ink-2">Nothing is recorded yet. The passport says &ldquo;Not recorded&rdquo;, which is not the same as no allergies.</p>
              <Button size="sm" variant="secondary" className="self-start" onClick={() => void add.run('allergy', '', true)} disabled={add.pending}>
                No known allergies
              </Button>
            </div>
          )}
          <AddEntry kind="allergy" onAdd={(text) => add.run('allergy', text, false)} pending={add.pending} />
        </Card>
        {(['condition', 'procedure'] as const).map((kind) => {
          const entries = health.filter((h) => h.kind === kind);
          return (
            <Card key={kind} as="section" aria-labelledby={`${kind}-title`}>
              <h3 id={`${kind}-title`} className="font-sans text-card-sm font-semibold">{LABEL[kind].title}</h3>
              {entries.length ? <EntryList entries={entries} onRemove={(id) => void remove.run(id)} pending={remove.pending} /> : <p className="mt-3 text-ink-2">{LABEL[kind].empty}</p>}
              <AddEntry kind={kind} onAdd={(text) => add.run(kind, text, false)} pending={add.pending} />
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function EntryList({ entries, onRemove, pending }: { entries: HealthEntry[]; onRemove: (id: string) => void; pending: boolean }) {
  return (
    <ul className="mt-3 flex flex-col gap-1">
      {entries.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-ink">{h.text}</span>
          <Button size="sm" variant="quiet" className="shrink-0" aria-label={`Remove ${h.text}`} icon={<X aria-hidden className="size-4" />} onClick={() => onRemove(h.id)} disabled={pending}>
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function AddEntry({ kind, onAdd, pending }: { kind: keyof typeof LABEL; onAdd: (text: string) => Promise<unknown>; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = LABEL[kind];
  if (!open) {
    return (
      <Button size="sm" variant="quiet" className="-ml-1 mt-3" icon={<Plus aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        Add {label.one === 'allergy' ? 'an allergy' : `a ${label.one}`}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim().replace(/\s+/g, ' ');
    if (!value) {
      setError(`Please type the ${label.one}.`);
      return;
    }
    if (await onAdd(value)) {
      setText('');
      setError(null);
      setOpen(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <Field label={`New ${label.one}`} hint={label.hint} value={text} onChange={(e) => setText(e.target.value)} error={error} autoComplete="off" autoFocus />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>Add</Button>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
      </div>
    </form>
  );
}
