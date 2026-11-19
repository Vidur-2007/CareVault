import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { ScreenFallback } from '../components/ScreenFallback';
import { ReviewScreen } from '../screens/ReviewScreen';
import { AppShell } from './AppShell';

/** Each screen is its own chunk; Review (the home screen) stays in the main bundle. */
function screen<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  const Screen = lazy(async () => ({ default: pick(await load()) }));
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Screen />
    </Suspense>
  );
}

/** Every route from overview spec section 11, plus the private /dev/components gallery. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <ReviewScreen /> },
      { path: '/medicines', element: screen(() => import('../screens/MedicinesScreen'), (m) => m.MedicinesScreen) },
      { path: '/medicines/scan', element: screen(() => import('../screens/ScanScreen'), (m) => m.ScanScreen) },
      { path: '/medicines/:id', element: screen(() => import('../screens/MedicineDetailScreen'), (m) => m.MedicineDetailScreen) },
      { path: '/records', element: screen(() => import('../screens/RecordsScreen'), (m) => m.RecordsScreen) },
      { path: '/records/:id', element: screen(() => import('../screens/DocumentDetailScreen'), (m) => m.DocumentDetailScreen) },
      { path: '/visit', element: screen(() => import('../screens/VisitScreen'), (m) => m.VisitScreen) },
      { path: '/visit/passport', element: screen(() => import('../screens/PassportScreen'), (m) => m.PassportScreen) },
      { path: '/settings', element: screen(() => import('../screens/SettingsScreen'), (m) => m.SettingsScreen) },
      { path: '*', element: screen(() => import('../screens/NotFoundScreen'), (m) => m.NotFoundScreen) },
    ],
  },
  // Without the shell:
  { path: '/welcome', element: screen(() => import('../screens/WelcomeScreen'), (m) => m.WelcomeScreen) },
  { path: '/share/:id', element: screen(() => import('../screens/ShareScreen'), (m) => m.ShareScreen) },
  // Private: not linked from navigation. Kept for design review.
  { path: '/dev/components', element: screen(() => import('../screens/DevComponentsScreen'), (m) => m.DevComponentsScreen) },
];
