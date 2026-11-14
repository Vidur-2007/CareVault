import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createMockServices } from '../mock/createMockServices';
import { App } from './App';
import { routes } from './routes';

function renderAt(path: string, seeded = true) {
  const services = createMockServices({ delayMs: 0, seeded, fail: () => null });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

describe('app shell', () => {
  it('renders navigation, the profile and the screen for the route', async () => {
    renderAt('/medicines');
    expect(await screen.findByRole('heading', { level: 1, name: 'Medicines' })).toBeInTheDocument();
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    for (const nav of navs) {
      expect(within(nav).getByRole('link', { name: /Medicines/ })).toHaveAttribute('aria-current', 'page');
      expect(within(nav).queryByRole('link', { name: /components/i })).toBeNull();
    }
    // Desktop and phone switchers are both in the DOM; CSS shows one per breakpoint.
    expect(screen.getAllByRole('button', { name: /Profile: Ramesh Iyer, Father, 71/ })).toHaveLength(2);
  });

  it('navigates between sections', async () => {
    const { router } = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Things to review' });
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    await userEvent.click(within(nav).getByRole('link', { name: /Visit/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'What changed since the last visit' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/visit');
  });

  it('sends a device with no profiles to /welcome, and the sample profile loads', async () => {
    const { router } = renderAt('/', false);
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to CareVault' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/welcome');
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample profile' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Things to review' })).toBeInTheDocument();
  });

  it('every route renders a page heading', async () => {
    for (const path of ['/medicines/scan', '/medicines/x', '/records', '/records/x', '/visit/passport', '/settings', '/share/abc', '/nope']) {
      const { unmount } = render(
        <App services={createMockServices({ delayMs: 0, fail: () => null })} router={createMemoryRouter(routes, { initialEntries: [path] })} />,
      );
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      unmount();
    }
  });
});
