import { motion } from 'motion/react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { BottomTabs } from '../components/BottomTabs';
import { CloudNotice } from '../components/CloudNotice';
import { ErrorPanel } from '../components/ErrorPanel';
import { Logo } from '../components/Logo';
import { ProfileSwitcher } from '../components/ProfileSwitcher';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { TopNav } from '../components/TopNav';
import { useCloudNotice, useProfile } from '../hooks/useContexts';
import { useMotionPresets } from './motion';
import { NAV_ITEMS, sectionAfterSwitch } from './navItems';

/** Layout for every signed-in screen: top bar (desktop) or compact bar plus bottom tabs (phone). */
export function AppShell() {
  const { profile, profiles, setProfileId, loading, error, reload } = useProfile();
  const cloud = useCloudNotice();
  const presets = useMotionPresets();
  const location = useLocation();
  const navigate = useNavigate();

  if (!loading && !error && !profile) return <Navigate to="/welcome" replace />;

  const switchProfile = (id: string) => {
    if (id === profile?.id) return;
    setProfileId(id);
    const target = sectionAfterSwitch(location.pathname);
    if (target !== location.pathname) navigate(target);
  };

  const switcher = (compact: boolean) => (
    <ProfileSwitcher profiles={profiles} current={profile} onSelect={switchProfile} compact={compact} />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        data-print-hide
        className="sr-only z-50 rounded-button bg-teal px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header data-print-hide className="sticky top-0 z-30 print:hidden">
        <div className="hidden md:block">
          <TopNav items={NAV_ITEMS} right={
              loading ? (
                <Skeleton className="h-12 w-40 rounded-full lg:w-60" />
              ) : (
                <>
                  <div className="lg:hidden">{switcher(true)}</div>
                  <div className="hidden lg:block">{switcher(false)}</div>
                </>
              )
            } />
        </div>
        <div className="flex h-[72px] items-center justify-between border-b border-line bg-surface px-5 md:hidden">
          <Link to="/" className="rounded-button">
            <Logo />
          </Link>
          {loading ? <Skeleton className="h-12 w-28 rounded-full" /> : switcher(true)}
        </div>
        <CloudNotice message={cloud.message} />
      </header>

      {/* Bottom padding clears the phone tab bar and the home indicator, so the last card is never hidden. */}
      <main id="main" tabIndex={-1} className="flex-1 pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none md:pb-16 print:pb-0">
        {loading ? (
          <div className="page-gutter py-8 md:py-12">
            <Skeleton className="mb-6 h-10 w-2/3 max-w-md" />
            <SkeletonList count={3} />
          </div>
        ) : error ? (
          <div className="page-gutter py-8 md:py-12">
            <ErrorPanel title="Your profiles could not be loaded" message={error.message} onRetry={reload} />
          </div>
        ) : (
          // Keyed on the profile too: a switch remounts the screen, so no state or cached result of the
          // previous profile survives, even for one frame (UI spec section 3).
          <motion.div key={`${profile?.id ?? ''}:${location.pathname}`} {...presets.page}>
            <Outlet />
          </motion.div>
        )}
      </main>

      <BottomTabs items={NAV_ITEMS} />
    </div>
  );
}
