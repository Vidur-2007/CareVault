import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { ScreenFallback } from '../components/ScreenFallback';
import { Placeholder } from '../screens/Placeholder';
import { AppShell } from './AppShell';

/** Each screen is its own chunk. */
function screen<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  const Screen = lazy(async () => ({ default: pick(await load()) }));
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Screen />
    </Suspense>
  );
}

export interface PlannedRoute {
  path: string;
  /** The page title: document.title is "<title> · CareVault". */
  title: string;
  /** The step of UI spec section 6 that builds the screen. */
  step: number;
  /** Rendered without the navigation (UI spec section 3). */
  bare?: boolean;
}

/**
 * The v2 routes of overview section 11 that still show a placeholder. Each one is replaced by its
 * screen in its step.
 */
export const PLANNED_ROUTES: PlannedRoute[] = [
];

const placeholder = (r: PlannedRoute): RouteObject => ({ path: r.path, element: <Placeholder title={r.title} step={r.step} /> });

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: screen(() => import('../screens/HomeScreen'), (m) => m.HomeScreen) },
      { path: '/settings', element: screen(() => import('../screens/SettingsScreen'), (m) => m.SettingsScreen) },
      { path: '/records', element: screen(() => import('../screens/RecordsScreen'), (m) => m.RecordsScreen) },
      { path: '/records/add', element: screen(() => import('../screens/AddRecordScreen'), (m) => m.AddRecordScreen) },
      { path: '/records/:id/verify', element: screen(() => import('../screens/VerifyScreen'), (m) => m.VerifyScreen) },
      { path: '/records/:id/review', element: screen(() => import('../screens/ReviewChangesScreen'), (m) => m.ReviewChangesScreen) },
      { path: '/passport', element: screen(() => import('../screens/PassportScreen'), (m) => m.PassportScreen) },
      { path: '/passport/medicines/:id', element: screen(() => import('../screens/MedicineDetailScreen'), (m) => m.MedicineDetailScreen) },
      { path: '/ask', element: screen(() => import('../screens/AskScreen'), (m) => m.AskScreen) },
      { path: '/passport/snapshots/:id', element: screen(() => import('../screens/SnapshotScreen'), (m) => m.SnapshotScreen) },
      { path: '/passport/print/:snapshotId', element: screen(() => import('../screens/PrintScreen'), (m) => m.PrintScreen) },
      { path: '/records/:id', element: screen(() => import('../screens/RecordDetailScreen'), (m) => m.RecordDetailScreen) },
      ...PLANNED_ROUTES.filter((r) => !r.bare).map(placeholder),
      { path: '*', element: screen(() => import('../screens/NotFoundScreen'), (m) => m.NotFoundScreen) },
    ],
  },
  // Without the navigation:
  { path: '/welcome', element: screen(() => import('../screens/WelcomeScreen'), (m) => m.WelcomeScreen) },
  { path: '/share/:id', element: screen(() => import('../screens/ShareScreen'), (m) => m.ShareScreen) },
  ...PLANNED_ROUTES.filter((r) => r.bare).map(placeholder),
  // Private: not linked from navigation. Kept for design review.
  { path: '/dev/components', element: screen(() => import('../screens/DevComponentsScreen'), (m) => m.DevComponentsScreen) },
];
