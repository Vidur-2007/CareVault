// Welcome, UI spec 4.1. Shown when there is no profile, and for "Add a profile" (?new=profile).
// Rendered without the navigation.
import { AnimatePresence, motion } from 'motion/react';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Profile } from '../../contract/types';
import { useMotionPresets } from '../app/motion';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Logo } from '../components/Logo';
import { useProfile, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceAction } from '../hooks/useServiceAction';
import { CreateProfileForm } from './welcome/CreateProfileForm';

export function WelcomeScreen() {
  const navigate = useNavigate();
  const presets = useMotionPresets();
  const toast = useToast();
  const { profiles, setProfileId } = useProfile();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === 'profile');
  const loadSample = useServiceAction((s) => s.profiles.loadSampleProfile(), {
    errorPrefix: 'The sample profiles could not be loaded',
  });
  useDocumentTitle(creating && profiles.length > 0 ? 'Add a profile' : 'Welcome');

  const enter = (profile: Profile) => {
    setProfileId(profile.id);
    navigate('/');
  };

  return (
    <div className="min-h-dvh bg-ground">
      <main className="mx-auto flex min-h-dvh w-full max-w-[680px] flex-col px-5 py-10 md:py-20">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          {profiles.length > 0 && (
            <Button to="/" variant="quiet">
              Back to Home
            </Button>
          )}
        </div>

        <h1 className="mt-10 text-page-sm md:mt-14 md:text-page">Welcome to CareVault</h1>
        <p className="mt-4 text-[18px] leading-[1.5] text-ink-2 md:text-[20px]">
          A family health passport: keep the medicines and medical records of someone you care for, or your own, in one
          place, and arrive at each doctor visit with what changed and what to ask.
        </p>
        <p className="mt-4 flex items-start gap-3 rounded-panel bg-teal-tint px-4 py-3 text-teal-ink">
          <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>Everything you add stays on this device. Nothing is sent anywhere unless you choose to.</span>
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            cta
            loading={loadSample.pending}
            disabled={creating}
            onClick={async () => {
              const profile = await loadSample.run();
              if (profile) {
                toast.show({ message: 'Sample profiles loaded. All of their data is invented.', tone: 'success' });
                enter(profile);
              }
            }}
          >
            Try the sample profiles
          </Button>
          {!creating && (
            <Button variant="secondary" cta className="!shadow-none" onClick={() => setCreating(true)} disabled={loadSample.pending}>
              Create a profile
            </Button>
          )}
        </div>
        <p className="mt-3 text-secondary text-ink-3">
          The sample profiles are a made-up father and mother with a few medicines and reports, so you can look around first.
        </p>

        <AnimatePresence>
          {creating && (
            <motion.div key="form" {...presets.collapse} className="overflow-hidden">
              <Card className="mt-8">
                <CreateProfileForm
                  onCancel={() => setCreating(false)}
                  onCreated={(profile) => {
                    toast.show({ message: `Profile for ${profile.name} created`, tone: 'success' });
                    enter(profile);
                  }}
                />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-auto pt-12 text-secondary text-ink-3">CareVault lists what you enter and confirm. It does not give medical advice.</p>
      </main>
    </div>
  );
}
