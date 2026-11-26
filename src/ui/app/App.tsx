import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import type { CareVaultServices } from '../../contract/services';
import { ToastProvider } from '../components/Toast';
import { CloudNoticeProvider } from './providers/CloudNoticeProvider';
import { ProfileProvider } from './providers/ProfileProvider';
import { ServicesProvider } from './providers/ServicesProvider';
import { routes } from './routes';

type AppRouter = ReturnType<typeof createBrowserRouter>;

export interface AppProps {
  /** Injected in tests; defaults to the implementation chosen in src/services. */
  services?: CareVaultServices;
  /** Injected in tests (e.g. createMemoryRouter(routes)); defaults to a browser router. */
  router?: AppRouter;
}

export function App({ services, router }: AppProps) {
  const [appRouter] = useState<AppRouter>(() => router ?? createBrowserRouter(routes));
  return (
    <MotionConfig reducedMotion="user">
      <ServicesProvider services={services}>
        <ToastProvider>
          <ProfileProvider>
            <CloudNoticeProvider>
              <RouterProvider router={appRouter} />
            </CloudNoticeProvider>
          </ProfileProvider>
        </ToastProvider>
      </ServicesProvider>
    </MotionConfig>
  );
}
