// The next visit on the Passport (UI spec 4.8): the visit itself (or "Add the next visit"),
// questions for the doctor, and the reports to share.
import { CalendarPlus, Plus, Star, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentRecord, Prescriber, Profile, Visit } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { useProfile } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { formatDate, formatTime, formatWeekdayDate, localDateTimeIso } from '../../lib/format';
import { KIND_LABEL } from '../../lib/labels';
import { shareableReports } from './passportText';

export interface VisitSectionProps {
  profile: Profile;
  visit: Visit | null;
  prescribers: Prescriber[];
  documents: DocumentRecord[];
}

export function VisitSection({ profile, visit, prescribers, documents }: VisitSectionProps) {
  const [editing, setEditing] = useState(false);
  const prescriber = visit ? prescribers.find((p) => p.id === visit.prescriberId) ?? null : null;

  return (
    <>
      <Card tone="dark" as="section" aria-labelledby="visit-title">
        <p className="text-secondary font-semibold uppercase tracking-wide text-teal-tint">Next visit</p>
        {visit ? (
          <>
            <h2 id="visit-title" className="mt-2 text-card">{formatWeekdayDate(visit.at)}</h2>
            <p className="mt-1 text-white/85">
              {[prescriber?.name, prescriber?.specialty.toLowerCase()].filter(Boolean).join(', ')} · {formatTime(visit.at)}
            </p>
            <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEditing(true)}>Change the visit</Button>
          </>
        ) : (
          <>
            <h2 id="visit-title" className="mt-2 text-card">No visit planned yet</h2>
            <p className="mt-1 text-white/85">Add it to keep questions and reports ready for the doctor.</p>
            <Button size="sm" variant="secondary" className="mt-4" icon={<CalendarPlus aria-hidden className="size-4" />} onClick={() => setEditing(true)}>
              Add the next visit
            </Button>
          </>
        )}
      </Card>
      <Dialog open={editing} onClose={() => setEditing(false)} title={visit ? 'Change the next visit' : 'Add the next visit'} size="md">
        {editing && <VisitForm profile={profile} visit={visit} prescribers={prescribers} onDone={() => setEditing(false)} />}
      </Dialog>
      <QuestionsCard visit={visit} />
      <ReportsCard visit={visit} documents={documents} />
    </>
  );
}

function VisitForm({ profile, visit, prescribers, onDone }: { profile: Profile; visit: Visit | null; prescribers: Prescriber[]; onDone: () => void }) {
  const { today } = useProfile();
  const [prescriberId, setPrescriberId] = useState(visit?.prescriberId ?? prescribers[0]?.id ?? '');
  const [date, setDate] = useState(visit?.at.slice(0, 10) ?? '');
  const [time, setTime] = useState(visit?.at.slice(11, 16) ?? '');
  const [doctor, setDoctor] = useState({ name: '', specialty: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addDoctor = useServiceAction((s) => s.profiles.addPrescriber(profile.id, { name: doctor.name.trim(), specialty: doctor.specialty.trim() }), {
    errorPrefix: 'The doctor could not be added',
  });
  const save = useServiceAction(
    (s, input: Omit<Visit, 'id'> & { id?: string }) => s.visits.save(input),
    { success: 'Visit saved', errorPrefix: 'The visit could not be saved' },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (prescribers.length === 0 && !doctor.name.trim()) found.doctor = "Please enter the doctor's name.";
    if (prescribers.length > 0 && !prescriberId) found.prescriber = 'Please choose the doctor.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = 'Please enter the date of the visit.';
    else if (date < today) found.date = 'The next visit cannot be in the past.';
    if (!/^\d{2}:\d{2}$/.test(time)) found.time = 'Please enter the time, like 10:30.';
    setErrors(found);
    const first = ['doctor', 'prescriber', 'date', 'time'].find((k) => found[k]);
    if (first) {
      document.getElementById(`visit-${first}`)?.focus();
      return;
    }
    let id = prescriberId;
    if (prescribers.length === 0) {
      const added = await addDoctor.run();
      if (!added) return;
      id = added.id;
    }
    const saved = await save.run({
      ...(visit ? { id: visit.id } : {}),
      profileId: profile.id, prescriberId: id, at: localDateTimeIso(date, time),
      questions: visit?.questions ?? [], sharedDocumentIds: visit?.sharedDocumentIds ?? [],
    });
    if (saved) onDone();
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      {prescribers.length === 0 ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-semibold text-ink">Add a doctor</legend>
          <Field id="visit-doctor" label="Doctor's name" value={doctor.name} onChange={(e) => setDoctor({ ...doctor, name: e.target.value })} error={errors.doctor} autoComplete="off" />
          <Field label="Specialty (optional)" value={doctor.specialty} onChange={(e) => setDoctor({ ...doctor, specialty: e.target.value })} autoComplete="off" />
        </fieldset>
      ) : (
        <Field
          id="visit-prescriber"
          as="select"
          label="Doctor"
          value={prescriberId}
          onChange={(e) => setPrescriberId(e.target.value)}
          error={errors.prescriber}
          options={prescribers.map((p) => ({ value: p.id, label: p.specialty ? `${p.name}, ${p.specialty}` : p.name }))}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="visit-date" type="date" label="Date" min={today} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <Field id="visit-time" type="time" label="Time" value={time} onChange={(e) => setTime(e.target.value)} error={errors.time} />
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={save.pending || addDoctor.pending}>Cancel</Button>
        <Button type="submit" loading={save.pending || addDoctor.pending}>Save the visit</Button>
      </div>
    </form>
  );
}

function QuestionsCard({ visit }: { visit: Visit | null }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useServiceAction((s, id: string, q: string) => s.visits.addQuestion(id, q), { errorPrefix: 'The question could not be saved' });
  const remove = useServiceAction((s, id: string, qid: string) => s.visits.removeQuestion(id, qid), { errorPrefix: 'The question could not be removed' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!visit) return;
    if (!text.trim()) {
      setError('Please type a question first.');
      return;
    }
    if (await add.run(visit.id, text.trim())) {
      setText('');
      setError(null);
    }
  };

  return (
    <Card as="section" aria-labelledby="questions-title">
      <h2 id="questions-title" className="font-sans text-card-sm font-semibold">Questions for the doctor</h2>
      {!visit ? (
        <p className="mt-3 text-ink-2">Add the next visit to keep questions for it.</p>
      ) : (
        <>
          {visit.questions.length === 0 ? (
            <p className="mt-3 text-ink-2">No questions yet.</p>
          ) : (
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
              {visit.questions.map((q) => (
                <li key={q.id}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-ink">{q.text}</span>
                    <Button size="sm" variant="quiet" aria-label={`Remove the question: ${q.text}`} icon={<X aria-hidden className="size-4" />} onClick={() => void remove.run(visit.id, q.id)} disabled={remove.pending}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <form noValidate onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field label="New question" value={text} onChange={(e) => setText(e.target.value)} error={error} autoComplete="off" className="flex-1" />
            <Button type="submit" className="sm:mt-8" icon={<Plus aria-hidden className="size-4" />} loading={add.pending}>Add</Button>
          </form>
        </>
      )}
    </Card>
  );
}

function ReportsCard({ visit, documents }: { visit: Visit | null; documents: DocumentRecord[] }) {
  const reports = shareableReports(documents);
  const set = useServiceAction((s, id: string, ids: string[]) => s.visits.setSharedDocuments(id, ids), { errorPrefix: 'The choice could not be saved' });
  return (
    <Card as="section" aria-labelledby="reports-title">
      <h2 id="reports-title" className="font-sans text-card-sm font-semibold">Reports to share</h2>
      {!visit ? (
        <p className="mt-3 text-ink-2">Add the next visit to choose the reports that go with the passport.</p>
      ) : reports.length === 0 ? (
        <p className="mt-3 text-ink-2">No filed reports yet.</p>
      ) : (
        <>
          <p className="mt-2 text-secondary text-ink-3">Their titles and dates are listed on the passport. The files themselves are not included in a link.</p>
          <div className="mt-2 flex flex-col">
            {reports.map((d) => (
              <Checkbox
                key={d.id}
                label={<span className="inline-flex items-center gap-1">{d.starred && <Star aria-label="Starred" className="size-4 fill-amber-ink text-amber-ink" />}{d.title}</span>}
                description={`${KIND_LABEL[d.kind]} · ${d.clinicalDate ? formatDate(d.clinicalDate) : 'date not known'}`}
                checked={visit.sharedDocumentIds.includes(d.id)}
                disabled={set.pending}
                onChange={(e) =>
                  void set.run(visit.id, e.target.checked ? [...visit.sharedDocumentIds, d.id] : visit.sharedDocumentIds.filter((x) => x !== d.id))
                }
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
