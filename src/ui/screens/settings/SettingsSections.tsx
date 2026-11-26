// Sections of Settings (UI spec 4.13): profiles, doctors, cloud reading, Gmail, older share links and
// sample data. Backup is in BackupSection.tsx.
import { CloudUpload, Link2Off, Mail, Pencil, Plus, RotateCcw, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import type { Profile } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorPanel } from '../../components/ErrorPanel';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { Skeleton, SkeletonList } from '../../components/Skeleton';
import { toServiceError } from '../../hooks/toServiceError';
import { useCloudNotice, useProfile, useServices, useToast } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { cx } from '../../lib/cx';
import { ageFrom, formatLocalDateTime } from '../../lib/format';
import { markGmailConnected, useGmailConnected } from '../../lib/gmailSession';
import { isActive } from '../passport/shareLinks';
import { CreateProfileForm } from '../welcome/CreateProfileForm';

const title = 'flex items-center gap-2 font-sans text-card-sm font-semibold md:text-card';

// ---------- profiles ----------

export function ProfilesSection({ startAdding = false }: { startAdding?: boolean }) {
  const { profile, profiles, setProfileId, today } = useProfile();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'edit'; profile: Profile } | null>(startAdding ? { mode: 'add' } : null);

  return (
    <Card as="section" aria-labelledby="profiles-title">
      <h2 id="profiles-title" className={title}>Profiles</h2>
      <p className="mt-2 text-ink-2">Each profile is one person. Their records stay separate.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {profiles.map((p) => {
          const current = p.id === profile?.id;
          const age = ageFrom(p.birthYear, today);
          const self = p.relation === 'Myself';
          return (
            <li key={p.id} className={cx('flex flex-wrap items-center gap-3 rounded-panel border p-4', current ? 'border-teal bg-teal-tint/50' : 'border-line')}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{p.name}</p>
                <p className="text-secondary text-ink-3">
                  {[self ? 'Own records' : p.relation, age !== null ? `${age} years` : null, !self && p.caregiverName ? `cared for by ${p.caregiverName}` : null].filter(Boolean).join(' · ')}
                </p>
                <p className="text-secondary text-ink-3">Emergency contact: {p.emergencyContact ?? 'not added'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Pencil aria-hidden className="size-4" />} aria-label={`Edit ${p.name}`} onClick={() => setSheet({ mode: 'edit', profile: p })}>
                  Edit
                </Button>
                {current ? (
                  <span className="inline-flex min-h-11 items-center px-2 text-secondary font-semibold text-teal-ink">Open now</span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Switch to ${p.name}`}
                    onClick={() => {
                      setProfileId(p.id);
                      toast.show({ message: `Switched to ${p.name}`, tone: 'success' });
                    }}
                  >
                    Switch
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" className="mt-4" icon={<Plus aria-hidden className="size-5" />} onClick={() => setSheet({ mode: 'add' })}>
        Add a profile
      </Button>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.mode === 'edit' ? 'Edit the profile' : 'Add a profile'}>
        {sheet && (
          <CreateProfileForm
            key={sheet.mode === 'edit' ? sheet.profile.id : 'add'}
            editing={sheet.mode === 'edit' ? sheet.profile : undefined}
            onCancel={() => setSheet(null)}
            onCreated={(saved) => {
              const adding = sheet.mode === 'add';
              setSheet(null);
              if (adding) {
                setProfileId(saved.id);
                toast.show({ message: `Profile for ${saved.name} created and opened`, tone: 'success' });
              } else toast.show({ message: 'Profile saved', tone: 'success' });
            }}
          />
        )}
      </Sheet>
    </Card>
  );
}

// ---------- doctors ----------

export function DoctorsSection() {
  const { profile, prescribers } = useProfile();
  const p = profile!;
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useServiceAction((s, input: { name: string; specialty: string }) => s.profiles.addPrescriber(p.id, input), {
    success: (d) => `${d.name} is in the list`,
    errorPrefix: 'The doctor could not be added',
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setError("Please type the doctor's name.");
      document.getElementById('doctor-name')?.focus();
      return;
    }
    setError(null);
    if (await add.run({ name: clean, specialty: specialty.trim() })) {
      setName('');
      setSpecialty('');
    }
  };

  return (
    <Card as="section" aria-labelledby="doctors-title">
      <h2 id="doctors-title" className={title}>
        <Stethoscope aria-hidden className="size-6 text-teal" />
        Doctors of {p.name}
      </h2>
      {prescribers.length === 0 ? (
        <p className="mt-3 text-ink-2">No doctors yet.</p>
      ) : (
        <ul aria-label={`Doctors of ${p.name}`} className="mt-3 flex flex-col gap-1">
          {prescribers.map((d) => (
            <li key={d.id} className="rounded-panel bg-surface-muted px-4 py-2 text-ink">
              <span className="font-semibold">{d.name}</span>
              {d.specialty && <span className="text-ink-2">, {d.specialty}</span>}
            </li>
          ))}
        </ul>
      )}
      <form noValidate onSubmit={submit} aria-label="Add a doctor" className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field id="doctor-name" label="Doctor's name" hint="For example: Dr. Kavita Rao" value={name} onChange={(e) => setName(e.target.value)} error={error} autoComplete="off" />
        <Field id="doctor-specialty" label="Specialty (optional)" hint="For example: Cardiology" value={specialty} onChange={(e) => setSpecialty(e.target.value)} autoComplete="off" />
        <Button type="submit" variant="secondary" loading={add.pending} icon={<Plus aria-hidden className="size-5" />}>Add the doctor</Button>
      </form>
    </Card>
  );
}

// ---------- cloud reading (as v1) ----------

export function CloudReadingSection() {
  const settings = useServiceQuery((s) => s.settings.get(), []);
  const set = useServiceAction((s, value: boolean) => s.settings.setCloudReadingAllowed(value), { success: () => 'Saved' });
  const allowed = settings.data?.cloudReadingAllowed ?? false;
  return (
    <Card as="section" aria-labelledby="cloud-title">
      <h2 id="cloud-title" className={title}>
        <CloudUpload aria-hidden className="size-6 text-teal" />
        Cloud reading
      </h2>
      <div className="mt-3 flex flex-col gap-2 text-ink-2">
        <p>Photos and PDFs are always read on this device first.</p>
        <p>
          When a page is too hard to read here, CareVault can send that one page to a cloud reader that reads the printed text. Only that page is
          sent, it is not stored by CareVault, and every value it reads is checked by you before it is used.
        </p>
        <p>
          <strong className="font-semibold text-ink">Off:</strong> you are asked each time. <strong className="font-semibold text-ink">On:</strong>{' '}
          hard-to-read pages are sent without asking, and a notice shows every time one is sent.
        </p>
      </div>
      {settings.loading ? (
        <div role="status" aria-label="Loading the cloud reading setting"><Skeleton className="mt-5 h-12 w-64 rounded-full" /></div>
      ) : settings.error ? (
        <ErrorPanel className="mt-5" title="This setting could not be loaded" message={settings.error.message} onRetry={settings.reload} />
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={allowed}
          onClick={() => void set.run(!allowed)}
          disabled={set.pending}
          className="mt-5 flex min-h-12 items-center gap-3 rounded-button pr-2 text-left disabled:opacity-60"
        >
          <span aria-hidden className={cx('relative h-8 w-14 shrink-0 rounded-full transition-colors', allowed ? 'bg-teal' : 'bg-line-strong')}>
            <span className={cx('absolute top-1 size-6 rounded-full bg-white shadow-card transition-[left]', allowed ? 'left-7' : 'left-1')} />
          </span>
          <span className="font-semibold text-ink">Send hard-to-read pages without asking</span>
          <span className="text-secondary text-ink-3">{allowed ? 'On' : 'Off'}</span>
        </button>
      )}
    </Card>
  );
}

// ---------- Gmail ----------

export function GmailSection() {
  const services = useServices();
  const cloud = useCloudNotice();
  const connected = useGmailConnected();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // gmail.connect runs straight from the tap, so the browser allows Google's window.
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await cloud.run('Connecting to Gmail', () => services.gmail.connect());
      markGmailConnected();
    } catch (err) {
      setError(toServiceError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="gmail-settings-title">
      <h2 id="gmail-settings-title" className={title}>
        <Mail aria-hidden className="size-6 text-blue-ink" />
        Gmail
      </h2>
      <p className="mt-3 text-ink-2">
        CareVault can look for emails with report PDFs. It reads your inbox only when you ask, for this session only, and copies only the
        attachments you choose.
      </p>
      {error && <ErrorPanel className="mt-4" title="Gmail could not be connected" message={error} />}
      {connected ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-ink">
          <span className="font-semibold">Gmail connected for this session ·</span>
          <Link to="/records/add?from=gmail" className="font-semibold text-teal underline underline-offset-2">Check for new reports</Link>
        </p>
      ) : (
        <Button className="mt-4" variant="secondary" onClick={() => void connect()} loading={busy}>Connect Gmail for this session</Button>
      )}
    </Card>
  );
}

// ---------- older share links ----------

export function OlderLinksSection() {
  const links = useServiceQuery((s) => s.sharing.listUnowned(), []);
  const revoke = useServiceAction((s, id: string) => s.sharing.revoke(id), { success: 'The link is turned off', errorPrefix: 'The link could not be turned off' });
  const active = (links.data ?? []).filter((l) => isActive(l));
  return (
    <Card as="section" aria-labelledby="older-links-title">
      <h2 id="older-links-title" className={title}>
        <Link2Off aria-hidden className="size-6 text-ink-3" />
        Older share links
      </h2>
      <p className="mt-3 text-ink-2">
        Links made with the earlier version of CareVault are not tied to a profile. Anyone with one can read that passport until it expires.
        Turn off any you no longer want open.
      </p>
      {links.loading ? (
        <SkeletonList count={1} lines={1} label="Loading older links" />
      ) : links.error ? (
        <ErrorPanel className="mt-4" title="The older links could not be loaded" message={links.error.message} onRetry={links.reload} />
      ) : active.length === 0 ? (
        <p className="mt-4 text-ink-3">No older links are open.</p>
      ) : (
        <ul aria-label="Older share links" className="mt-4 flex flex-col gap-2">
          {active.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-surface-muted px-4 py-3">
              <span className="text-ink">Earlier passport link · expires {formatLocalDateTime(l.expiresAt)}</span>
              <Button
                size="sm"
                variant="secondary"
                className="!border-red-line !text-red-ink hover:!bg-red-tint"
                aria-label={`Revoke the earlier passport link that expires ${formatLocalDateTime(l.expiresAt)}`}
                loading={revoke.pending}
                onClick={() => void revoke.run(l.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- sample data ----------

export function SampleSection() {
  const { setProfileId } = useProfile();
  const toast = useToast();
  const load = useServiceAction((s) => s.profiles.loadSampleProfile(), { errorPrefix: 'The sample profiles could not be loaded' });
  return (
    <Card as="section" aria-labelledby="sample-title">
      <h2 id="sample-title" className={title}>Sample data</h2>
      <p className="mt-2 text-ink-2">
        Two invented profiles, a father and a mother, with medicines, prescriptions and reports, for trying CareVault out. Loading them again
        adds whatever is missing; your own profiles are not changed.
      </p>
      <Button
        variant="secondary"
        className="mt-4"
        icon={<RotateCcw aria-hidden className="size-5" />}
        loading={load.pending}
        onClick={async () => {
          const sample = await load.run();
          if (sample) {
            setProfileId(sample.id);
            toast.show({ message: 'The sample profiles are loaded.', tone: 'success' });
          }
        }}
      >
        Load the sample profiles
      </Button>
    </Card>
  );
}
