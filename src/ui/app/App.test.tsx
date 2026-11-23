import '../test/configureTesting';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import { useProfile } from '../hooks/useContexts';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { App } from './App';
import { sectionAfterSwitch } from './navItems';
import { PLANNED_ROUTES, routes } from './routes';

const mock = (opts: { seeded?: boolean; delayMs?: number } = {}) => createMockServicesV2({ delayMs: 0, fail: () => null, ...opts });

function renderAt(path: string, opts: { seeded?: boolean; delayMs?: number; routes?: RouteObject[] } = {}) {
  const services = mock(opts);
  const router = createMemoryRouter(opts.routes ?? routes, { initialEntries: [path] });
  const view = render(<App services={services} router={router} />);
  return { services, router, ...view };
}

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('v2 shell and navigation', () => {
  it('shows Home, Records, Passport and Ask, with Settings in the profile menu', async () => {
    renderAt('/records');
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2); // desktop top bar and phone tabs; CSS shows one
    for (const nav of navs) {
      expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Records', 'Passport', 'Ask']);
      expect(within(nav).getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page');
    }
    // Phone, tablet and desktop menus are all in the DOM; CSS shows one per breakpoint.
    const menus = screen.getAllByRole('button', { name: 'Profile: Ramesh Iyer, Father, 71. Profile menu' });
    expect(menus).toHaveLength(3);
    await userEvent.click(menus[0]);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Add a profile' })).toHaveAttribute('href', '/welcome?new=profile');
    expect(screen.getByRole('button', { name: /Lakshmi Iyer/ })).toBeInTheDocument();
  });

  it('moves between sections', async () => {
    const { router } = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Ramesh Iyer' });
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    await userEvent.click(within(nav).getByRole('link', { name: 'Passport' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Passport' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/passport');
    expect(document.title).toBe('Passport · CareVault');
  });

  it('sends a device with no profiles to /welcome, and the sample profiles load', async () => {
    const { router, services } = renderAt('/', { seeded: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to CareVault' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/welcome');
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample profiles' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ramesh Iyer' })).toBeInTheDocument();
    expect((await services.profiles.list()).map((p) => p.id)).toEqual([IDS.ramesh, IDS.lakshmi]);
  });

  // Every route loads its own lazy screen: more than the default 5 s on a slow machine.
  it('every v2 route renders its screen or placeholder and sets document.title', { timeout: 30000 }, async () => {
    const cases = [
      ...PLANNED_ROUTES.map((r) => ({ path: r.path.replace(/:[a-zA-Z]+/g, 'x'), heading: r.title, title: `${r.title} · CareVault`, bare: !!r.bare })),
      { path: '/records', heading: 'Records', title: 'Records · CareVault', bare: false },
      { path: '/records/x', heading: 'Record not found', title: 'Record · CareVault', bare: false },
      { path: '/records/add', heading: 'Add a record', title: 'Add a record · CareVault', bare: false },
      { path: '/records/x/verify', heading: 'Check the values', title: 'Check the values · CareVault', bare: false },
      { path: '/records/x/review', heading: 'What changed on this prescription', title: 'Review changes · CareVault', bare: false },
      { path: '/passport/snapshots/x', heading: 'Passport not found', title: 'Passport snapshot · CareVault', bare: false },
      { path: '/passport/print/x', heading: 'Passport not found', title: 'Print the passport · CareVault', bare: false },
      { path: '/', heading: 'Ramesh Iyer', title: 'Home · CareVault', bare: false },
      { path: '/settings', heading: 'Settings', title: 'Settings · CareVault', bare: false },
      { path: '/ask', heading: 'Ask CareVault', title: 'Ask · CareVault', bare: false },
      { path: '/share/x', heading: 'This link is incomplete', title: 'Shared passport · CareVault', bare: true },
      { path: '/passport', heading: 'Passport', title: 'Passport · CareVault', bare: false },
      { path: '/passport/medicines/x', heading: 'Medicine not found', title: 'Medicine · CareVault', bare: false },
      { path: `/records/${IDS.documents.lipidProfile}`, heading: 'Lipid profile', title: 'Lipid profile · CareVault', bare: false },
      { path: '/welcome', heading: 'Welcome to CareVault', title: 'Welcome · CareVault', bare: true },
      { path: '/no-such-page', heading: 'This page does not exist', title: 'Page not found · CareVault', bare: false },
    ];
    expect(cases.map((c) => c.path)).toEqual(expect.arrayContaining([
      '/', '/records', '/records/add', '/records/x', '/records/x/verify', '/records/x/review', '/passport',
      '/passport/medicines/x', '/passport/snapshots/x', '/passport/print/x', '/ask', '/settings', '/welcome', '/share/x',
    ]));
    for (const c of cases) {
      document.title = '';
      const { unmount } = renderAt(c.path);
      expect(await screen.findByRole('heading', { level: 1, name: c.heading })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(document.title).toBe(c.title);
      expect(screen.queryAllByRole('navigation', { name: 'Main' })).toHaveLength(c.bare ? 0 : 2);
      unmount();
    }
  });
});

// ---------- profile switching ----------

const RAMESH_ONLY = ['Amlodipine 10 mg', 'Dr. Kavita Rao'];
const LAKSHMI_ONLY = ['Levothyroxine 50 mcg', 'Dr. Farah Khan'];

/** A test screen that shows profile data the way real screens load it. */
function Probe() {
  const { profile, prescribers } = useProfile();
  const routine = useServiceQuery((s) => s.routine.list(profile!.id), [profile?.id]);
  return (
    <div>
      <h1>Probe</h1>
      <p>{prescribers.map((p) => p.name).join(', ')}</p>
      {routine.loading ? <p>Loading medicines</p> : <ul>{routine.data?.map((m) => <li key={m.id}>{m.productName}</li>)}</ul>}
    </div>
  );
}

const probeRoutes: RouteObject[] = [
  { element: routes[0].element, children: [{ path: '/probe', element: <Probe /> }, ...(routes[0].children ?? [])] },
  ...routes.slice(1),
];

/** Records every text that appears in the page, so a single frame with old data is caught. */
function watchText() {
  const seen: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) if (node.textContent) seen.push(node.textContent);
      if (r.type === 'characterData' && r.target.textContent) seen.push(r.target.textContent);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return {
    seen,
    stop: () => {
      for (const r of observer.takeRecords()) for (const node of r.addedNodes) if (node.textContent) seen.push(node.textContent);
      observer.disconnect();
    },
  };
}

async function switchTo(name: RegExp) {
  await userEvent.click(screen.getAllByRole('button', { name: /Profile menu/ })[0]);
  await userEvent.click(screen.getByRole('button', { name }));
}

describe('switching profile', () => {
  it("never shows the previous profile's data, even for one frame", async () => {
    renderAt('/probe', { routes: probeRoutes, delayMs: 30 });
    for (const text of RAMESH_ONLY) expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();

    const watch = watchText();
    await switchTo(/Lakshmi Iyer/);
    // Straight after the switch is rendered: nothing of Ramesh's is left on screen.
    for (const text of RAMESH_ONLY) expect(screen.queryByText(new RegExp(text))).toBeNull();
    for (const text of LAKSHMI_ONLY) expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    watch.stop();
    for (const text of RAMESH_ONLY) expect(watch.seen.filter((t) => t.includes(text))).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Profile: Lakshmi Iyer, Mother, 68. Profile menu' })).toHaveLength(3);

    // And back.
    const back = watchText();
    await switchTo(/Ramesh Iyer/);
    for (const text of LAKSHMI_ONLY) expect(screen.queryByText(new RegExp(text))).toBeNull();
    expect(await screen.findByText('Amlodipine 10 mg')).toBeInTheDocument();
    back.stop();
    for (const text of LAKSHMI_ONLY) expect(back.seen.filter((t) => t.includes(text))).toEqual([]);
  });

  it('keeps the choice, and leaves a record or medicine page for its section', async () => {
    const { router } = renderAt(`/records/${IDS.documents.lipidProfile}`);
    await screen.findByRole('heading', { level: 1, name: 'Lipid profile' });
    await switchTo(/Lakshmi Iyer/);
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/records');
    expect(localStorage.getItem('cv.profileId')).toBe(IDS.lakshmi);

    expect(sectionAfterSwitch('/passport/medicines/abc')).toBe('/passport');
    expect(sectionAfterSwitch('/passport/print/abc')).toBe('/passport');
    expect(sectionAfterSwitch('/records/add')).toBe('/records');
    expect(sectionAfterSwitch('/ask')).toBe('/ask');
    expect(sectionAfterSwitch('/')).toBe('/');
  });

  it('opens the stored profile on start', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    renderAt('/');
    expect((await screen.findAllByRole('button', { name: /Profile: Lakshmi Iyer/ })).length).toBe(3);
  });
});
