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
  { path: '/', title: 'Home', step: 9 },
  { path: '/records/:id/review', title: 'Review changes', step: 6 },
  { path: '/passport/snapshots/:id', title: 'Passport snapshot', step: 7 },
  { path: '/passport/print/:snapshotId', title: 'Print the passport', step: 7 },
  { path: '/ask', title: 'Ask', step: 8 },
  { path: '/settings', title: 'Settings', step: 9 },
  { path: '/share/:id', title: 'Shared passport', step: 7, bare: true },
];

const placeholder = (r: PlannedRoute): RouteObject => ({ path: r.path, element: <Placeholder title={r.title} step={r.step} /> });

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/records', element: screen(() => import('../screens/RecordsScreen'), (m) => m.RecordsScreen) },
      { path: '/records/add', element: screen(() => import('../screens/AddRecordScreen'), (m) => m.AddRecordScreen) },
      { path: '/records/:id/verify', element: screen(() => import('../screens/VerifyScreen'), (m) => m.VerifyScreen) },
      { path: '/passport', element: screen(() => import('../screens/PassportScreen'), (m) => m.PassportScreen) },
      { path: '/passport/medicines/:id', element: screen(() => import('../screens/MedicineDetailScreen'), (m) => m.MedicineDetailScreen) },
      { path: '/records/:id', element: screen(() => import('../screens/RecordDetailScreen'), (m) => m.RecordDetailScreen) },
      ...PLANNED_ROUTES.filter((r) => !r.bare).map(placeholder),
      { path: '*', element: screen(() => import('../screens/NotFoundScreen'), (m) => m.NotFoundScreen) },
    ],
  },
  // Without the navigation:
  { path: '/welcome', element: screen(() => import('../screens/WelcomeScreen'), (m) => m.WelcomeScreen) },
  ...PLANNED_ROUTES.filter((r) => r.bare).map(placeholder),
  // Private: not linked from navigation. Kept for design review.
  { path: '/dev/components', element: screen(() => import('../screens/DevComponentsScreen'), (m) => m.DevComponentsScreen) },
];
