import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useProfile } from '../hooks/useContexts';
import { useServiceAction } from '../hooks/useServiceAction';

/** Placeholder until phase 2; "Try the sample profile" already works so an empty device is usable. */
export function WelcomeScreen() {
  const navigate = useNavigate();
  const { setProfileId } = useProfile();
  const loadSample = useServiceAction((s) => s.profiles.loadSampleProfile(), { success: 'Sample profile loaded' });

  return (
    <main className="page-gutter flex min-h-dvh flex-col justify-center py-12">
      <Logo />
      <h1 className="mt-8 text-page-sm md:text-page">Welcome to CareVault</h1>
      <p className="mt-4 max-w-xl text-ink-2">
        CareVault keeps the medicines and medical records of a parent in one place. Everything stays on this device.
      </p>
      <p className="mt-2 text-ink-3">The full welcome screen and profile form are built in phase 2.</p>
      <div className="mt-8">
        <Button
          cta
          loading={loadSample.pending}
          onClick={async () => {
            const profile = await loadSample.run();
            if (profile) {
              setProfileId(profile.id);
              navigate('/');
            }
          }}
        >
          Try the sample profile
        </Button>
      </div>
    </main>
  );
}
