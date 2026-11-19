// Settings, UI spec 7.11: profiles, cloud reading, Gmail import, backup, sample data, about.
import { CloudUpload, Plus, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorPanel } from '../components/ErrorPanel';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { useProfile, useToast } from '../hooks/useContexts';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { ageFrom } from '../lib/format';
import { today as getToday } from '../lib/today';
import { BackupSection } from './settings/BackupSection';
import { GmailSection } from './settings/GmailSection';
import { CreateProfileForm } from './welcome/CreateProfileForm';

function CloudReadingSection() {
  const settings = useServiceQuery((s) => s.settings.get(), []);
  const set = useServiceAction((s, value: boolean) => s.settings.setCloudReadingAllowed(value), {
    success: () => 'Saved',
  });
  const allowed = settings.data?.cloudReadingAllowed ?? false;

  return (
    <Card as="section" aria-labelledby="cloud-title">
      <h2 id="cloud-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold md:text-card">
        <CloudUpload aria-hidden className="size-6 text-teal" />
        Cloud reading
      </h2>
      <div className="mt-3 flex flex-col gap-2 text-ink-2">
        <p>Photos and PDFs are always read on this device first.</p>
        <p>
          When a photo is too hard to read here, CareVault can send that one photo to a cloud reader (Google’s Gemini) that reads the printed
          text. Only that photo is sent. Nothing else from this device goes with it, it is not stored by CareVault, and you check every field
          before anything is saved.
        </p>
        <p>
          <strong className="font-semibold text-ink">Off:</strong> you are asked each time. <strong className="font-semibold text-ink">On:</strong>{' '}
          hard-to-read photos are sent without asking, and a notice shows every time one is sent.
        </p>
      </div>
      {settings.loading ? (
        <div role="status" aria-label="Loading the cloud reading setting">
          <Skeleton className="mt-5 h-12 w-64 rounded-full" />
        </div>
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
          <span
            aria-hidden
            className={cx('relative h-8 w-14 shrink-0 rounded-full transition-colors', allowed ? 'bg-teal' : 'bg-line-strong')}
          >
            <span className={cx('absolute top-1 size-6 rounded-full bg-white shadow-card transition-[left]', allowed ? 'left-7' : 'left-1')} />
          </span>
          <span className="font-semibold text-ink">Send hard-to-read photos without asking</span>
          <span className="text-secondary text-ink-3">{allowed ? 'On' : 'Off'}</span>
        </button>
      )}
    </Card>
  );
}

export function SettingsScreen() {
  const { profile, profiles, setProfileId } = useProfile();
  const pid = profile!.id;
  const toast = useToast();
  const location = useLocation();
  const today = getToday();
  const [adding, setAdding] = useState(location.hash === '#add-profile');
  const loadSample = useServiceAction((s) => s.profiles.loadSampleProfile());

  return (
    <div className="page-gutter py-6 md:py-12">
      <h1 className="text-page-sm md:text-page">Settings</h1>
      <p className="mt-3 max-w-2xl text-ink-2 md:text-[20px] md:leading-[1.5]">Profiles, privacy and backups for this device.</p>

      <div className="mt-8 flex max-w-4xl flex-col gap-6 md:mt-10">
        <Card as="section" aria-labelledby="profiles-title">
          <h2 id="profiles-title" className="font-sans text-card-sm font-semibold md:text-card">
            Profiles
          </h2>
          <p className="mt-2 text-ink-2">Each profile is one person you care for. Their records stay separate.</p>
          <ul className="mt-4 flex flex-col gap-2">
            {profiles.map((p) => {
              const current = p.id === pid;
              const age = ageFrom(p.birthYear, today);
              return (
                <li
                  key={p.id}
                  className={cx('flex flex-wrap items-center gap-3 rounded-panel border p-4', current ? 'border-teal bg-teal-tint/50' : 'border-line')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <p className="text-secondary text-ink-3">
                      {p.relation}
                      {age !== null ? `, ${age}` : ''} · cared for by {p.caregiverName}
                    </p>
                  </div>
                  {current ? (
                    <span className="text-secondary font-semibold text-teal-ink">Open now</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setProfileId(p.id);
                        toast.show({ message: `Switched to ${p.name}`, tone: 'success' });
                      }}
                      aria-label={`Switch to ${p.name}`}
                    >
                      Switch
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button variant="secondary" className="mt-4" icon={<Plus aria-hidden className="size-5" />} onClick={() => setAdding(true)}>
            Add a profile
          </Button>
        </Card>

        <CloudReadingSection />

        <GmailSection profileId={pid} profileName={profile!.name.split(' ')[0]} />

        <BackupSection today={today} />

        <Card as="section" aria-labelledby="sample-title">
          <h2 id="sample-title" className="font-sans text-card-sm font-semibold md:text-card">
            Sample data
          </h2>
          <p className="mt-2 text-ink-2">
            The sample profile is an invented father with a few medicines, prescriptions and reports, for trying CareVault out. Loading it again
            adds it if it is missing and opens it; your own profiles are not changed.
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            icon={<RotateCcw aria-hidden className="size-5" />}
            loading={loadSample.pending}
            onClick={async () => {
              const sample = await loadSample.run();
              if (sample) {
                setProfileId(sample.id);
                toast.show({ message: 'The sample profile is open.', tone: 'success' });
              }
            }}
          >
            Load the sample profile
          </Button>
        </Card>

        <Card as="section" aria-labelledby="about-title">
          <h2 id="about-title" className="font-sans text-card-sm font-semibold md:text-card">
            About CareVault
          </h2>
          <ul className="mt-3 flex flex-col gap-3 text-ink-2">
            <li className="flex gap-3">
              <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
              <span>
                Your records stay on this device. They leave it only when you send a hard-to-read photo to the cloud reader, import from Gmail, or
                share a passport, which is encrypted on this phone first.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
              <span>
                CareVault is not medical advice. It lists and adds up what you entered and confirmed, and never tells anyone to start or stop a
                medicine. Please check with a pharmacist or the prescriber.
              </span>
            </li>
          </ul>
          <p className="mt-4 text-secondary text-ink-3">CareVault · built for GenHacks 2026 · all sample data is synthetic.</p>
        </Card>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a profile">
        <CreateProfileForm
          onCancel={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setProfileId(created.id);
            toast.show({ message: `Profile for ${created.name} created and opened`, tone: 'success' });
          }}
        />
      </Sheet>
    </div>
  );
}
