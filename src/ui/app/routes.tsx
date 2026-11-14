import type { RouteObject } from 'react-router';
import { DevComponentsScreen } from '../screens/DevComponentsScreen';
import { DocumentDetailScreen } from '../screens/DocumentDetailScreen';
import { MedicineDetailScreen } from '../screens/MedicineDetailScreen';
import { MedicinesScreen } from '../screens/MedicinesScreen';
import { NotFoundScreen } from '../screens/NotFoundScreen';
import { PassportScreen } from '../screens/PassportScreen';
import { RecordsScreen } from '../screens/RecordsScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ShareScreen } from '../screens/ShareScreen';
import { VisitScreen } from '../screens/VisitScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { AppShell } from './AppShell';

/** Every route from overview spec section 11, plus the private /dev/components gallery. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <ReviewScreen /> },
      { path: '/medicines', element: <MedicinesScreen /> },
      { path: '/medicines/scan', element: <ScanScreen /> },
      { path: '/medicines/:id', element: <MedicineDetailScreen /> },
      { path: '/records', element: <RecordsScreen /> },
      { path: '/records/:id', element: <DocumentDetailScreen /> },
      { path: '/visit', element: <VisitScreen /> },
      { path: '/visit/passport', element: <PassportScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
  // Without the shell:
  { path: '/welcome', element: <WelcomeScreen /> },
  { path: '/share/:id', element: <ShareScreen /> },
  // Private: not linked from navigation. Kept for design review.
  { path: '/dev/components', element: <DevComponentsScreen /> },
];
