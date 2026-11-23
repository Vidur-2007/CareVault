// Step 4 of "Add a record" (UI spec 4.4): kind, title, date, doctor (or "Add this doctor") and
// facility, and the patient-mismatch question, which must be answered before going on.
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentRecord, ExtractionCandidate } from '../../../../contract/types';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { toServiceError } from '../../../hooks/toServiceError';
import { useProfile, useServices, useToast } from '../../../hooks/useContexts';
import { formatDate } from '../../../lib/format';
import { KIND_LABEL, KIND_ORDER, pagesText } from '../../../lib/labels';
import { matchPrescriber } from '../checkText';
import { detailsPatch, validateDetails } from '../recordsText';
import type { DetailsErrors, DetailsValues } from '../recordsText';

export type DetailsNotice = 'locked' | 'manual' | null;

export interface DetailsStepProps {
  record: DocumentRecord;
  candidate: ExtractionCandidate | null;
  notice: DetailsNotice;
  onSaved: (record: DocumentRecord) => void;
  /** The record left this profile: moved to another one, or removed as "Not ours". */
  onGone: (message: string) => void;
}

const ORDER: (keyof DetailsValues)[] = ['kind', 'title', 'clinicalDate', 'prescriberId', 'facility'];
const fieldId = (key: keyof DetailsValues) => `add-${key}`;

export function DetailsStep({ record, candidate, notice, onSaved, onGone }: DetailsStepProps) {
  const services = useServices();
  const toast = useToast();
  const { profile, profiles, prescribers, today } = useProfile();
  const readDoctor = candidate?.prescriberName ?? null;
  const matched = matchPrescriber(readDoctor, prescribers);

  const [values, setValues] = useState<DetailsValues>(() => ({
    kind: candidate?.kind ?? record.kind,
    title: candidate?.title ?? record.title,
    clinicalDate: candidate?.clinicalDate ?? record.clinicalDate ?? '',
    prescriberId: matched?.id ?? record.prescriberId ?? '',
    facility: candidate?.facility ?? record.facility ?? '',
    tags: (candidate?.tags ?? record.tags).join(', '),
    testNames: (candidate?.testNames ?? record.testNames).join(', '),
  }));
  const [errors, setErrors] = useState<DetailsErrors & { patient?: string }>({});
  const [saving, setSaving] = useState(false);
  const [doctorForm, setDoctorForm] = useState<{ name: string; specialty: string } | null>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [addingDoctor, setAddingDoctor] = useState(false);

  const mismatch = (candidate?.patientMatch ?? record.patientMatch) === 'mismatch';
  const nameRead = candidate?.patientNameRead ?? record.patientNameRead;
  const [patientAnswer, setPatientAnswer] = useState<'yes' | 'other' | null>(null);
  const [otherProfile, setOtherProfile] = useState('');
  const [patientBusy, setPatientBusy] = useState(false);
  const others = profiles.filter((p) => p.id !== profile!.id);

  const set = (key: keyof DetailsValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const pages = candidate ? pagesText({ pageCount: candidate.pageCount, pagesRead: candidate.pagesRead }) : null;
  const partial = candidate !== null && candidate.pageCount !== null && candidate.pagesRead !== null && candidate.pagesRead < candidate.pageCount;

  const addDoctor = async () => {
    if (!doctorForm) return;
    if (!doctorForm.name.trim()) {
      setDoctorError("Please enter the doctor's name.");
      return;
    }
    setAddingDoctor(true);
    try {
      const added = await services.profiles.addPrescriber(profile!.id, { name: doctorForm.name.trim(), specialty: doctorForm.specialty.trim() });
      setValues((v) => ({ ...v, prescriberId: added.id }));
      setDoctorForm(null);
      setDoctorError(null);
      toast.show({ message: `${added.name} added to ${profile!.name.split(' ')[0]}'s doctors`, tone: 'success' });
    } catch (err) {
      setDoctorError(toServiceError(err).message);
    } finally {
      setAddingDoctor(false);
    }
  };

  const confirmPatient = async () => {
    setPatientBusy(true);
    try {
      // The user says the record is this profile's: that settles the patient name value.
      const evidence = (await services.documents.fields(record.id)).filter((e) => e.field === 'patient_name' && (e.status === 'needs_verification' || e.status === 'extracted'));
      if (evidence.length) await services.documents.reviewFields(record.id, evidence.map((e) => ({ evidenceId: e.id, action: 'confirm' as const })));
      setPatientAnswer('yes');
      setErrors((x) => ({ ...x, patient: undefined }));
    } catch (err) {
      toast.show({ message: toServiceError(err).message, tone: 'error' });
    } finally {
      setPatientBusy(false);
    }
  };

  const moveTo = async () => {
    const target = profiles.find((p) => p.id === otherProfile);
    if (!target) return;
    setPatientBusy(true);
    try {
      await services.documents.assignProfile(record.id, target.id);
      onGone(`Moved to ${target.name}'s records, as not yet filed`);
    } catch (err) {
      toast.show({ message: toServiceError(err).message, tone: 'error' });
      setPatientBusy(false);
    }
  };

  const notOurs = async () => {
    setPatientBusy(true);
    try {
      await services.documents.remove(record.id);
      onGone(`Removed ${record.title}`);
    } catch (err) {
      toast.show({ message: toServiceError(err).message, tone: 'error' });
      setPatientBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: DetailsErrors & { patient?: string } = validateDetails(values, today);
    if (values.kind === 'prescription' && !values.prescriberId) found.prescriberId = 'Please choose the doctor who wrote this prescription, or add them.';
    if (mismatch && patientAnswer !== 'yes') found.patient = `Please say whose record this is first.`;
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    if (found.patient) {
      document.getElementById('add-patient')?.focus();
      return;
    }
    setSaving(true);
    try {
      const patch = detailsPatch(record, values);
      const saved = Object.keys(patch).length ? await services.documents.update(record.id, patch) : record;
      onSaved(saved);
    } catch (err) {
      toast.show({ message: `The details could not be saved. ${toServiceError(err).message}`, tone: 'error' });
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6" aria-label="The details">
      <div>
        <p className="text-ink-2">
          {candidate ? 'These were read from the document. Change anything that is not right.' : 'Type the details from the document.'}
        </p>
      </div>

      {notice === 'locked' && (
        <Card tone="muted" role="status">
          <p className="font-semibold text-ink">This PDF is password-protected. It is saved; fill in the details by hand.</p>
        </Card>
      )}
      {pages && (
        <p className={partial ? 'rounded-panel bg-amber-tint px-4 py-3 font-semibold text-amber-ink' : 'text-secondary text-ink-3'}>
          {pages}
          {partial && '. The other pages were not read; check the original for anything on them.'}
        </p>
      )}

      {mismatch && (
        <Card tone="action" as="section" aria-labelledby="add-patient">
          <h3 id="add-patient" tabIndex={-1} className="font-sans text-card-sm font-semibold">
            This looks like a record for {nameRead}. Is it for {profile!.name}?
          </h3>
          {errors.patient && <p className="mt-2 font-semibold text-red-ink">{errors.patient}</p>}
          {patientAnswer === 'yes' ? (
            <p className="mt-3 text-teal-ink">Noted: it is {profile!.name}&rsquo;s record.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button variant="secondary" onClick={() => void confirmPatient()} loading={patientBusy && patientAnswer === null}>
                  Yes
                </Button>
                {others.length > 0 && (
                  <Button variant="secondary" onClick={() => setPatientAnswer('other')} disabled={patientBusy}>
                    It is for another profile
                  </Button>
                )}
                <Button variant="secondary" onClick={() => void notOurs()} disabled={patientBusy} className="!border-red-line !text-red-ink">
                  Not ours
                </Button>
              </div>
              {patientAnswer === 'other' && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field
                    as="select"
                    label="Whose record is it?"
                    value={otherProfile}
                    onChange={(ev) => setOtherProfile(ev.target.value)}
                    options={[{ value: '', label: 'Choose a profile' }, ...others.map((p) => ({ value: p.id, label: `${p.name} (${p.relation})` }))]}
                    className="flex-1"
                  />
                  <Button onClick={() => void moveTo()} disabled={!otherProfile} loading={patientBusy}>
                    Move it
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fieldId('kind')} as="select" label="Kind" value={values.kind} onChange={set('kind')} options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Field id={fieldId('title')} label="Title" value={values.title} onChange={set('title')} error={errors.title} autoComplete="off" />
        <Field
          id={fieldId('clinicalDate')}
          type="date"
          label="Date on the document"
          hint={candidate?.clinicalDate ? `Read from the document: ${formatDate(candidate.clinicalDate)}.` : 'No date was found. Leave it empty if the document shows none: it is kept as "Date not known".'}
          max={today}
          value={values.clinicalDate}
          onChange={set('clinicalDate')}
          error={errors.clinicalDate}
        />
        <Field id={fieldId('facility')} label="Facility (optional)" hint="The lab, clinic or hospital, as printed." value={values.facility} onChange={set('facility')} error={errors.facility} autoComplete="off" />
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Field
            id={fieldId('prescriberId')}
            as="select"
            label={values.kind === 'prescription' ? 'Doctor' : 'Doctor (optional)'}
            value={values.prescriberId}
            onChange={set('prescriberId')}
            error={errors.prescriberId}
            options={[{ value: '', label: 'No doctor' }, ...prescribers.map((p) => ({ value: p.id, label: p.specialty ? `${p.name}, ${p.specialty}` : p.name }))]}
          />
          {readDoctor && !matched && !doctorForm && (
            <p className="text-ink-2">
              &ldquo;{readDoctor}&rdquo; was read from the document but is not one of {profile!.name.split(' ')[0]}&rsquo;s doctors.
            </p>
          )}
          {!doctorForm ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              icon={<UserPlus aria-hidden className="size-4" />}
              onClick={() => setDoctorForm({ name: readDoctor && !matched ? readDoctor : '', specialty: '' })}
            >
              {readDoctor && !matched ? 'Add this doctor' : 'Add a doctor'}
            </Button>
          ) : (
            <Card tone="muted" as="section" aria-label="Add a doctor">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Doctor's name" value={doctorForm.name} onChange={(ev) => setDoctorForm({ ...doctorForm, name: ev.target.value })} error={doctorError} autoComplete="off" autoFocus />
                <Field label="Specialty (optional)" hint="For example: Cardiology" value={doctorForm.specialty} onChange={(ev) => setDoctorForm({ ...doctorForm, specialty: ev.target.value })} autoComplete="off" />
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => void addDoctor()} loading={addingDoctor}>Save the doctor</Button>
                <Button size="sm" variant="secondary" onClick={() => { setDoctorForm(null); setDoctorError(null); }}>Cancel</Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={saving}>Continue</Button>
      </div>
    </form>
  );
}
