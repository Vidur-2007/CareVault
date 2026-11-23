import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { ServiceError, type ShareLink } from '../../contract/types';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { changeText } from '../lib/changes';
import { formatDate } from '../lib/format';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { linksOfSnapshot, qrLinkFor } from './passport/shareLinks';

const M = IDS.medicines;
const make = (opts: { delayMs?: number; seeded?: boolean } = {}) => createMockServicesV2({ delayMs: opts.delayMs ?? 0, seeded: opts.seeded, fail: () => null });

function renderAt(path: string, services: CareVaultServices) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return router;
}

/** The QR on the page, by the link it encodes; null when no QR is shown. */
const qrLinkId = () => document.querySelector('[data-link-id]')?.getAttribute('data-link-id') ?? null;
/** Navigations render as transitions: wait for the page itself, not only the router's location. */
async function onPassportPage() {
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Health passport' })).toBeNull());
  return screen.findByRole('button', { name: 'Print' });
}
async function onPrintPage(router: { state: { location: { pathname: string } } }, not?: string) {
  await waitFor(() => expect(router.state.location.pathname).toMatch(not ? new RegExp(`^/passport/print/(?!${not}$)`) : /^\/passport\/print\//));
  await screen.findByRole('article', { name: 'Health passport' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save a snapshot' })).toBeNull());
}
const sharePath = (link: ShareLink) => { const u = new URL(link.url); return `${u.pathname}${u.hash}`; };

let print: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  print = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  print.mockRestore();
  localStorage.removeItem('cv.profileId');
});

describe('print', () => {
  // Three print rounds, the first loading the lazy screens: more than the default 5 s on slow machines.
  it('creates a snapshot first, or reuses it when nothing changed, then prints that snapshot', { timeout: 15000 }, async () => {
    const s = make();
    const snapshot = vi.spyOn(s.passport, 'snapshot');
    const router = renderAt('/passport', s);
    await screen.findByRole('heading', { level: 1, name: 'Passport' });

    await userEvent.click(await screen.findByRole('button', { name: 'Print' }));
    await onPrintPage(router);
    expect(snapshot).toHaveBeenCalledWith(IDS.ramesh, 'print');
    const first = router.state.location.pathname.split('/').pop()!;
    expect((await s.passport.snapshots(IDS.ramesh)).map((x) => x.id)).toEqual([first]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Health passport' })).toBeInTheDocument();
    expect(document.title).toBe('Print the passport · CareVault');
    expect(screen.getAllByText('Passport 1 · prepared 14 Nov 2026').length).toBeGreaterThan(0);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // The print view says which reports are listed and that files are not in the link.
    expect(screen.getByText(/Reports listed: Lipid profile, ECG report\. Original files are not included in the link\./)).toBeInTheDocument();
    // Safety information is on the printed page: allergies, unconfirmed entries, flags.
    const page = screen.getByRole('article', { name: 'Health passport' });
    expect(within(page).getByText('Sulfa drugs: rash')).toBeInTheDocument();
    expect(within(within(page).getByRole('region', { name: 'Current use not confirmed' })).getByText('Atorvastatin 10 mg')).toBeInTheDocument();
    expect(within(page).getByRole('region', { name: 'Flag for review' })).toHaveTextContent(/same active ingredient/);
    // The ingredient line only when it adds to the name; the reason only when it adds to the heading.
    expect(within(page).getByText('paracetamol 650 mg')).toBeInTheDocument();
    expect(within(page).queryByText('amlodipine 10 mg')).toBeNull();
    expect(within(page).getByRole('region', { name: 'Current use not confirmed' })).toHaveTextContent(/^Current use not confirmedAtorvastatin 10 mg$/);

    // Nothing changed: printing again reuses the same snapshot.
    await router.navigate('/passport');
    await userEvent.click(await onPassportPage());
    await onPrintPage(router);
    expect(router.state.location.pathname).toBe(`/passport/print/${first}`);
    expect(await s.passport.snapshots(IDS.ramesh)).toHaveLength(1);

    // After a routine change, printing makes passport 2.
    await s.routine.setStatus(M.dolo650, 'stopped');
    await router.navigate('/passport');
    await userEvent.click(await onPassportPage());
    await onPrintPage(router, first);
    const snaps = await s.passport.snapshots(IDS.ramesh);
    expect(snaps.map((x) => x.revision)).toEqual([2, 1]);
    expect(router.state.location.pathname).toBe(`/passport/print/${snaps[0].id}`);
  });

  it('prints a saved snapshot as it is, without making a new one', async () => {
    const s = make();
    const saved = await s.passport.snapshot(IDS.ramesh, 'manual');
    await s.routine.setStatus(M.dolo650, 'stopped');
    const router = renderAt(`/passport/snapshots/${saved.id}`, s);
    await userEvent.click(await screen.findByRole('button', { name: 'Print' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/passport/print/${saved.id}`));
    expect(await s.passport.snapshots(IDS.ramesh)).toHaveLength(1);
  });
});

describe('the printed QR', () => {
  it('is only ever the QR of a link to that exact snapshot, never one chosen by expiry', async () => {
    const s = make();
    const a = await s.passport.snapshot(IDS.ramesh, 'share');
    const linkA = await s.sharing.create(a.id, 24); // expires last
    await s.routine.setStatus(M.dolo650, 'stopped');
    const b = await s.passport.snapshot(IDS.ramesh, 'print');

    // Passport 2 has no link of its own: no QR, although passport 1 has an active link.
    let router = renderAt(`/passport/print/${b.id}`, s);
    expect(await screen.findByText(/No QR code is printed: there is no active link to this passport/)).toBeInTheDocument();
    expect(qrLinkId()).toBeNull();

    // A link for passport 2, with a shorter expiry: its own QR is printed.
    const linkB = await s.sharing.create(b.id, 2);
    await waitFor(() => expect(qrLinkId()).toBe(linkB.id));
    expect(screen.getByText(/The QR code opens this passport until/)).toBeInTheDocument();

    // Asking for another snapshot's link by id does not put it on this snapshot.
    router.dispose();
    document.body.innerHTML = '';
    router = renderAt(`/passport/print/${b.id}?link=${linkA.id}`, s);
    await waitFor(() => expect(qrLinkId()).toBe(linkB.id));

    // Passport 1 prints its own link; once revoked, no QR at all.
    await router.navigate(`/passport/print/${a.id}`);
    await waitFor(() => expect(qrLinkId()).toBe(linkA.id));
    await s.sharing.revoke(linkA.id);
    await waitFor(() => expect(qrLinkId()).toBeNull());
  });

  it('the share dialog binds the link to a snapshot and can print with exactly that QR', async () => {
    const s = make();
    const create = vi.spyOn(s.sharing, 'create');
    const router = renderAt('/passport', s);
    await userEvent.click(await screen.findByRole('button', { name: 'Share with QR' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share with a QR code' });
    expect(dialog).toHaveAccessibleDescription('The passport is encrypted on this device. Anyone with the link can read it until it expires.');
    expect(await within(dialog).findByText('Passport 1 · prepared 14 Nov 2026')).toBeInTheDocument();
    const [snap] = await s.passport.snapshots(IDS.ramesh);
    expect(snap.reason).toBe('share');
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['2 hours', '8 hours', '24 hours']);
    await userEvent.click(within(dialog).getByRole('radio', { name: '2 hours' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(snap.id, 2));
    const link = await create.mock.results[0].value;
    await waitFor(() => expect(qrLinkId()).toBe(link.id));
    expect(within(dialog).getByLabelText('Link')).toHaveValue(link.url);
    expect(within(dialog).getByText(/^Expires /)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Print with this QR code' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/passport/print/${snap.id}`));
    expect(router.state.location.search).toBe(`?link=${link.id}`);
    await waitFor(() => expect(qrLinkId()).toBe(link.id));
  });

  it('Revoke turns the link off, and the active links list comes from sharing.list', async () => {
    const s = make();
    const snap = await s.passport.snapshot(IDS.ramesh, 'share');
    const link = await s.sharing.create(snap.id, 8);
    renderAt('/passport', s);
    const links = await screen.findByRole('region', { name: 'Active links' });
    expect(within(links).getByText(/^Passport 1 · expires /)).toBeInTheDocument();
    await userEvent.click(within(links).getByRole('button', { name: /^Revoke the link/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Active links' })).toBeNull());
    expect((await s.sharing.list(IDS.ramesh)).find((l) => l.id === link.id)?.revoked).toBe(true);
  });

  it('helpers: a recent change does not repeat its kind', () => {
    expect(changeText({ kind: 'started', text: 'Started Dolo 650' })).toBe('Dolo 650');
    expect(changeText({ kind: 'changed', text: 'Amlodipine 10 mg (5 mg to 10 mg)' })).toBe('Amlodipine 10 mg (5 mg to 10 mg)');
    expect(changeText({ kind: 'not_started', text: 'Not started' })).toBe('Not started');
  });

  it('helpers: a QR link comes from the snapshot asked for, never from another by expiry', () => {
    const now = Date.parse('2026-11-14T10:00:00Z');
    const mk = (id: string, snapshotId: string | null, expiresAt: string, createdAt = '2026-11-14T09:00:00Z', revoked = false): ShareLink =>
      ({ id, profileId: 'p', snapshotId, url: `https://x/share/${id}#k`, createdAt, expiresAt, revoked });
    const links = [
      mk('other', 's2', '2026-11-20T00:00:00Z'),
      mk('old', 's1', '2026-11-14T12:00:00Z', '2026-11-14T08:00:00Z'),
      mk('new', 's1', '2026-11-14T11:00:00Z', '2026-11-14T09:30:00Z'),
      mk('gone', 's1', '2026-11-15T00:00:00Z', '2026-11-14T09:45:00Z', true),
      mk('v1', null, '2026-11-30T00:00:00Z'),
    ];
    expect(linksOfSnapshot(links, 's1', now).map((l) => l.id)).toEqual(['new', 'old']);
    expect(qrLinkFor(links, 's1', null, now)?.id).toBe('new');
    expect(qrLinkFor(links, 's1', 'old', now)?.id).toBe('old');
    expect(qrLinkFor(links, 's1', 'other', now)?.id).toBe('new');
    expect(qrLinkFor(links, 's3', null, now)).toBeNull();
  });
});

describe('two profiles never cross', () => {
  it('another profile’s snapshot, print page and links are never shown', async () => {
    const s = make();
    const ramesh = await s.passport.snapshot(IDS.ramesh, 'share');
    await s.sharing.create(ramesh.id, 24);
    localStorage.setItem('cv.profileId', IDS.lakshmi);

    const router = renderAt(`/passport/snapshots/${ramesh.id}`, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Passport not found' })).toBeInTheDocument();
    await router.navigate(`/passport/print/${ramesh.id}`);
    await waitFor(() => expect(document.title).toBe('Print the passport · CareVault'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Passport not found' })).toBeInTheDocument();
    expect(qrLinkId()).toBeNull();

    // Lakshmi's own print: her snapshot, no QR (Ramesh's link is not hers), none of his data.
    await router.navigate('/passport');
    await screen.findByRole('heading', { level: 1, name: 'Passport' });
    expect(screen.queryByRole('region', { name: 'Active links' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Print' }));
    const page = await screen.findByRole('article', { name: 'Health passport' });
    expect(within(page).getByText(/Lakshmi Iyer/)).toBeInTheDocument();
    expect(within(within(page).getByRole('region', { name: 'Current medicines' })).getByText('Levothyroxine 50 mcg')).toBeInTheDocument();
    expect(page).not.toHaveTextContent(/Ramesh|Amlodipine|Sulfa/);
    expect(await screen.findByText(/No QR code is printed/)).toBeInTheDocument();
    expect(qrLinkId()).toBeNull();
    const [lakshmi] = await s.passport.snapshots(IDS.lakshmi);
    expect(lakshmi.profileId).toBe(IDS.lakshmi);
    expect(router.state.location.pathname).toBe(`/passport/print/${lakshmi.id}`);
    expect((await s.sharing.list(IDS.lakshmi))).toEqual([]);
  });
});

describe('a snapshot is frozen', () => {
  it('reads the same after a routine edit, and after a record delete only says the original was removed', async () => {
    const s = make();
    const snap = await s.passport.snapshot(IDS.ramesh, 'manual');
    renderAt(`/passport/snapshots/${snap.id}`, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Passport 1' })).toBeInTheDocument();
    expect(screen.getByText('Passport 1 · prepared 14 Nov 2026 · saved by hand')).toBeInTheDocument();
    const view = () => screen.getByRole('article', { name: 'Health passport' });
    const before = view().textContent!;
    expect(before).toContain('Dolo 650');
    expect(before).toContain('Telmisartan 40 mg');

    // Routine and health edits: the live passport changes, the snapshot does not.
    await s.routine.setStatus(M.dolo650, 'stopped');
    await s.routine.update(M.telmisartan40, { instruction: '1 tablet, night' });
    await s.health.add(IDS.ramesh, { kind: 'allergy', text: 'Penicillin: hives', noneKnown: false, source: 'caregiver_reported', documentId: null });
    expect((await s.passport.live(IDS.ramesh)).currentMedicines.map((m) => m.productName)).not.toContain('Dolo 650');
    await waitFor(async () => expect((await s.passport.getSnapshot(snap.id)).passport).toEqual(snap.passport));
    expect(view().textContent).toBe(before);

    // A record delete: the title, kind and date stay; it says when the original was removed; no link back.
    await s.documents.remove(IDS.documents.lipidProfile);
    const removedAt = (await s.passport.getSnapshot(snap.id)).passport.documents.find((d) => d.documentId === IDS.documents.lipidProfile)!.removedAt!;
    const note = ` · Original removed on ${formatDate(removedAt)}`;
    await waitFor(() => expect(view()).toHaveTextContent(note.trim()));
    expect(view().textContent).toBe(before.replace('Lipid profile, Lab report, 12 Nov 2026', `Lipid profile, Lab report, 12 Nov 2026${note}`));
    expect(within(view()).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('the public share page', () => {
  it('opens a valid link read-only, without navigation, even on a device with no profiles', async () => {
    const s = make({ delayMs: 40 });
    const snap = await s.passport.snapshot(IDS.ramesh, 'share');
    const link = await s.sharing.create(snap.id, 2);
    const router = renderAt(sharePath(link), s);
    expect(await screen.findByText('Opening and decrypting the passport…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Health passport' })).toBeInTheDocument();
    expect(screen.getByText('Passport 1 · prepared 14 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText(/Shared passport · read-only · passport 1/)).toBeInTheDocument();
    expect(screen.queryAllByRole('navigation', { name: 'Main' })).toHaveLength(0);
    expect(document.title).toBe('Shared passport · CareVault');
    expect(router.state.location.pathname).toBe(`/share/${link.id}`);

    // The doctor's device has no profiles: the page is not sent to Welcome.
    const empty = make({ seeded: false });
    vi.spyOn(empty.sharing, 'open').mockResolvedValue(snap);
    document.body.innerHTML = '';
    const other = renderAt(sharePath(link), empty);
    expect(await screen.findByRole('heading', { level: 1, name: 'Health passport' })).toBeInTheDocument();
    expect(other.state.location.pathname).toBe(`/share/${link.id}`);
  });

  it('shows the missing key, not found, revoked, expired and error states', async () => {
    const s = make();
    const snap = await s.passport.snapshot(IDS.ramesh, 'share');
    const link = await s.sharing.create(snap.id, 2);
    const id = link.id;

    const router = renderAt(`/share/${id}`, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })).toBeInTheDocument();

    await router.navigate(`/share/${id}#wrongkey`);
    expect(await screen.findByRole('heading', { level: 1, name: 'This passport could not be found' })).toBeInTheDocument();

    await s.sharing.revoke(id);
    await router.navigate(sharePath(link));
    expect(await screen.findByRole('heading', { level: 1, name: 'This link was turned off' })).toBeInTheDocument();

    const open = vi.spyOn(s.sharing, 'open').mockRejectedValueOnce(new ServiceError('expired', 'This link has expired.'));
    await router.navigate(`/share/${id}#other`);
    expect(await screen.findByRole('heading', { level: 1, name: 'This passport link has expired' })).toBeInTheDocument();

    open.mockRejectedValueOnce(new ServiceError('network', 'offline')).mockResolvedValueOnce(snap);
    await router.navigate(`/share/${id}#again`);
    expect(await screen.findByRole('heading', { level: 1, name: 'The passport could not be opened' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Health passport' })).toBeInTheDocument();
  });
});
