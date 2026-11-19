import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Prescriber } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { useServiceAction } from '../../hooks/useServiceAction';
import { localDateTimeIso } from '../../lib/format';

/** Shown when there is no next visit: prescriber, date and time. */
export function AddVisitForm({ profileId, prescribers, today, defaultPrescriberId }: { profileId: string; prescribers: Prescriber[]; today: string; defaultPrescriberId?: string | null }) {
  const [prescriberId, setPrescriberId] = useState(defaultPrescriberId ?? prescribers[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [errors, setErrors] = useState<{ prescriberId?: string; date?: string; time?: string }>({});
  const save = useServiceAction(
    (s) => s.visits.save({ profileId, prescriberId, at: localDateTimeIso(date, time), questions: [], sharedDocumentIds: [] }),
    { success: 'Visit added' },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!prescriberId) found.prescriberId = 'Please choose the doctor.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = 'Please choose the date of the visit.';
    else if (date < today) found.date = 'The visit date cannot be in the past.';
    if (!/^\d{2}:\d{2}$/.test(time)) found.time = 'Please choose the time.';
    setErrors(found);
    const first = (['prescriberId', 'date', 'time'] as const).find((k) => found[k]);
    if (first) {
      document.getElementById(`visit-${first}`)?.focus();
      return;
    }
    void save.run();
  };

  return (
    <Card as="section" aria-labelledby="add-visit-title">
      <h2 id="add-visit-title" className="font-sans text-card-sm font-semibold md:text-card">
        No visit is planned yet
      </h2>
      <p className="mt-2 text-ink-2">Add the next appointment to collect questions and prepare the passport.</p>
      {prescribers.length === 0 ? (
        <p className="mt-4 text-ink-3">Add a prescription in Records first, so CareVault knows the doctor.</p>
      ) : (
        <form noValidate onSubmit={submit} className="mt-5 grid gap-5 sm:grid-cols-3">
          <Field
            id="visit-prescriberId"
            label="Doctor"
            as="select"
            options={prescribers.map((p) => ({ value: p.id, label: `${p.name}, ${p.specialty.toLowerCase()}` }))}
            value={prescriberId}
            onChange={(e) => setPrescriberId(e.target.value)}
            error={errors.prescriberId}
          />
          <Field id="visit-date" label="Date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          <Field id="visit-time" label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={errors.time} />
          <div className="sm:col-span-3">
            <Button type="submit" loading={save.pending}>
              Add the visit
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
