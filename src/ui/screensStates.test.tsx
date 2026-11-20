// Phase 6 pass over every screen: the four states (loading, empty, ready, error) and the basic
// accessibility rules (one h1, labelled controls, named buttons, alt text, a live region).
import './test/configureTesting';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareVaultServices } from '../contract/legacy/services';
import { IDS } from '../contract/legacy/fixtures/sampleCase';
import { App } from './app/App';
import { routes } from './app/routes';
import { createMockServices } from './mock/createMockServices';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T09:00:00') });
});
afterEach(() => {
  vi.useRealTimers();
});

const ALL_BUT_PROFILES = 'medicines,reading,documents,prescriptions,review,visits,sharing,gmail,backup,settings';

const SCREENS: { path: string; loading: RegExp; error: RegExp; ready: RegExp }[] = [
  { path: '/', loading: /Loading things to review/, error: /Things to review could not be loaded/, ready: /things to review/i },
  { path: '/medicines', loading: /Loading medicines/, error: /Medicines could not be loaded/, ready: /^Medicines$/ },
  { path: `/medicines/${IDS.medicines.amlodipine10}`, loading: /Loading the medicine/, error: /This medicine could not be loaded/, ready: /Amlodipine 10 mg/ },
  { path: '/records', loading: /Loading records/, error: /Records could not be loaded/, ready: /^Records$/ },
  { path: `/records/${IDS.documents.lipidProfile}`, loading: /Loading the record/, error: /This record could not be loaded/, ready: /Lipid profile/ },
  { path: '/visit', loading: /Loading the visit/, error: /The next visit could not be loaded/, ready: /What changed since the last visit/ },
  { path: '/visit/passport', loading: /Preparing the passport/, error: /The passport could not be prepared/, ready: /Doctor Visit Passport/ },
  { path: '/settings', loading: /Loading the cloud reading setting/, error: /This setting could not be loaded/, ready: /Settings/ },
];

function renderAt(path: string, services: CareVaultServices) {
  return render(<App services={services} router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

/** Every call outside `profiles` stays pending, so screens stay in their loading state. */
function neverLoading(): CareVaultServices {
  const services = createMockServices({ delayMs: 0, fail: () => null });
  const groups = services as unknown as Record<string, Record<string, unknown>>;
  for (const [group, methods] of Object.entries(groups)) {
    if (group === 'profiles' || typeof methods !== 'object') continue;
    for (const name of Object.keys(methods)) methods[name] = () => new Promise(() => {});
  }
  return services;
}

/** The basic accessibility rules every screen must meet. Returns the problems found. */
function a11yProblems(root: HTMLElement): string[] {
  const problems: string[] = [];
  const h1 = root.querySelectorAll('h1').length;
  if (h1 !== 1) problems.push(`${h1} h1 elements`);
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
    if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLInputElement).type === 'hidden') continue;
    const labelled = (el.labels?.length ?? 0) > 0 || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
    if (!labelled) problems.push(`unlabelled ${el.tagName.toLowerCase()} ${el.id || el.getAttribute('name') || ''}`);
  }
  for (const b of root.querySelectorAll('button, a[href]')) {
    if (b.closest('[aria-hidden="true"]')) continue;
    const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
    if (!name) problems.push(`unnamed ${b.tagName.toLowerCase()} ${b.outerHTML.slice(0, 80)}`);
  }
  for (const img of root.querySelectorAll('img')) if (!img.hasAttribute('alt')) problems.push('img without alt');
  return problems;
}

describe('every screen has its four states', () => {
  for (const s of SCREENS) {
    it(`${s.path}: loading`, async () => {
      renderAt(s.path, neverLoading());
      expect(await screen.findByRole('status', { name: s.loading })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it(`${s.path}: error (mock failure switch)`, async () => {
      renderAt(s.path, createMockServices({ delayMs: 0, fail: () => ALL_BUT_PROFILES }));
      expect(await screen.findByText(s.error)).toBeInTheDocument();
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });

    it(`${s.path}: ready, with one h1 and labelled controls`, async () => {
      const { container } = renderAt(s.path, createMockServices({ delayMs: 0, fail: () => null }));
      expect(await screen.findByRole('heading', { level: 1, name: s.ready })).toBeInTheDocument();
      // Let the remaining queries settle before inspecting the page.
      await waitFor(() => expect(container.querySelector('[role="status"][aria-label^="Loading"]')).toBeNull());
      expect(a11yProblems(container)).toEqual([]);
    });
  }

  it('empty states on a profile with no data', async () => {
    const services = createMockServices({ delayMs: 0, seeded: false, fail: () => null });
    await services.profiles.create({ name: 'Lakshmi Iyer', relation: 'Mother', birthYear: 1958, caregiverName: 'Ravi Iyer', caregiverRelation: 'son' });
    const expectations: [string, RegExp][] = [
      ['/', /Nothing needs your review/],
      ['/medicines', /No medicines yet/],
      ['/records', /No records yet/],
      ['/visit', /No visit is planned yet/],
      ['/visit/passport', /No medicine has been confirmed yet/],
    ];
    for (const [path, text] of expectations) {
      const { unmount, container } = renderAt(path, services);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(a11yProblems(container)).toEqual([]);
      unmount();
    }
  });

  it('toasts are announced through one polite live region', async () => {
    const { container } = renderAt('/', createMockServices({ delayMs: 0, fail: () => null }));
    await screen.findByRole('heading', { level: 1 });
    expect(container.ownerDocument.querySelectorAll('[aria-live="polite"][role="status"]').length).toBeGreaterThan(0);
  });

  it('welcome and the shared view meet the same rules', async () => {
    const services = createMockServices({ delayMs: 0, seeded: false, fail: () => null });
    const w = renderAt('/welcome', services);
    await screen.findByRole('heading', { level: 1, name: 'Welcome to CareVault' });
    expect(a11yProblems(w.container)).toEqual([]);
    w.unmount();
    const share = renderAt('/share/abc', services);
    await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' });
    expect(a11yProblems(share.container)).toEqual([]);
  });
});
