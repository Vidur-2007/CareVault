import { motion } from 'motion/react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { BottomTabs } from '../components/BottomTabs';
import { CloudNotice } from '../components/CloudNotice';
import { ErrorPanel } from '../components/ErrorPanel';
import { Logo } from '../components/Logo';
import { ProfileSwitcher } from '../components/ProfileSwitcher';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { TopNav } from '../components/TopNav';
import { useCloudNotice, useProfile } from '../hooks/useContexts';
import { today } from '../lib/today';
import { useMotionPresets } from './motion';
import { NAV_ITEMS } from './navItems';

/** Layout for every signed-in screen: top bar (desktop) or compact bar plus bottom tabs (phone). */
export function AppShell() {
  const { profile, profiles, setProfileId, loading, error, reload } = useProfile();
  const cloud = useCloudNotice();
  const presets = useMotionPresets();
  const location = useLocation();

  if (!loading && !error && !profile) return <Navigate to="/welcome" replace />;

  const switcher = (compact: boolean) => (
    <ProfileSwitcher profiles={profiles} current={profile} onSelect={setProfileId} today={today()} compact={compact} />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-button bg-teal px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30">
        <div className="hidden md:block">
          <TopNav items={NAV_ITEMS} right={loading ? <Skeleton className="h-12 w-60 rounded-full" /> : switcher(false)} />
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
      <main id="main" tabIndex={-1} className="flex-1 pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none md:pb-16">
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
          <motion.div key={location.pathname} {...presets.page}>
            <Outlet />
          </motion.div>
        )}
      </main>

      <BottomTabs items={NAV_ITEMS} />
    </div>
  );
}
