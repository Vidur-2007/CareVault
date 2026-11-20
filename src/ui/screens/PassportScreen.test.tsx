import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../contract/legacy/types';
import type { CareVaultServices } from '../../contract/legacy/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { PASSPORT_DISCLAIMER } from '../components/PassportView';
import { createMockServices } from '../mock/createMockServices';
import { SHARE_EXPLANATION } from './passport/ShareDialog';

function renderAt(path: string, services: CareVaultServices = createMockServices({ delayMs: 0, fail: () => null })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

describe('Doctor Visit Passport', () => {
  it('matches the mockup sections', async () => {
    renderAt('/visit/passport');
    expect(await screen.findByRole('heading', { level: 1, name: 'Doctor Visit Passport' })).toBeInTheDocument();
    expect(screen.getByText('For the visit with Dr. Kavita Rao, cardiology, on Wednesday, 18 November 2026')).toBeInTheDocument();
    expect(screen.getByText('Ramesh Iyer, 71')).toBeInTheDocument();
    expect(screen.getByText('Anjali Iyer, daughter')).toBeInTheDocument();
    expect(screen.getByText('14 November 2026')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5); // header + 4 medicines
    expect(screen.getByText('Changes since the previous prescription of 5 August')).toBeInTheDocument();
    for (const pill of ['+ Added', 'Changed', 'Unconfirmed']) expect(screen.getByText(pill)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Flag for review' })).toBeInTheDocument();
    expect(screen.getByText('Lipid profile, 12 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions from the family' })).toBeInTheDocument();
    expect(screen.getByText(PASSPORT_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument();
  });

  it('shares with a QR link, copies it, and revokes it', async () => {
    const { services } = renderAt('/visit/passport');
    const create = vi.spyOn(services.sharing, 'create');
    const revoke = vi.spyOn(services.sharing, 'revoke');
    await userEvent.click(await screen.findByRole('button', { name: 'Share with QR' }));

    const dialog = await screen.findByRole('dialog', { name: 'Share with a QR code' });
    expect(within(dialog).getByText(SHARE_EXPLANATION)).toBeInTheDocument();
    expect(SHARE_EXPLANATION).toBe('The passport is encrypted on this phone. The link holds the key; anyone with the link can read it until it expires.');
    await userEvent.click(within(dialog).getByRole('radio', { name: '24 hours' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1]).toBe(24);
    expect(create.mock.calls[0][0].patientName).toBe('Ramesh Iyer');
    const qr = await within(dialog).findByRole('img', { name: 'QR code for the passport link' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect((within(dialog).getByLabelText('Link') as HTMLInputElement).value).toMatch(/\/share\/.+#.+/);
    expect(within(dialog).getByText(/^Expires /)).toBeInTheDocument();

    // jsdom has no clipboard: the link is selected for manual copying instead.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Select the link and copy it.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText(/This link is turned off/)).toBeInTheDocument();
  });

  it('shows the cloud notice while the encrypted passport uploads', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    let release: () => void = () => {};
    const original = services.sharing.create.bind(services.sharing);
    vi.spyOn(services.sharing, 'create').mockImplementation(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return original(...args);
    });
    renderAt('/visit/passport', services);
    await userEvent.click(await screen.findByRole('button', { name: 'Share with QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    expect((await screen.findAllByText('Uploading the encrypted passport')).length).toBeGreaterThan(0);
    release();
    await waitFor(() => expect(screen.queryByText('Uploading the encrypted passport')).toBeNull());
  });
});

describe('Shared passport view', () => {
  it('shows the expired state when sharing.open rejects with expired', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    vi.spyOn(services.sharing, 'open').mockRejectedValue(new ServiceError('expired', 'This link has expired.'));
    renderAt('/share/abc#secret', services);
    expect(await screen.findByRole('heading', { level: 1, name: 'This passport link has expired' })).toBeInTheDocument();
    expect(services.sharing.open).toHaveBeenCalledWith('abc', 'secret');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows distinct revoked, not found and missing-key states', async () => {
    const revoked = createMockServices({ delayMs: 0, fail: () => null });
    vi.spyOn(revoked.sharing, 'open').mockRejectedValue(new ServiceError('revoked', 'Revoked'));
    const { unmount } = render(<App services={revoked} router={createMemoryRouter(routes, { initialEntries: ['/share/abc#k'] })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link was turned off' })).toBeInTheDocument();
    unmount();

    const missing = createMockServices({ delayMs: 0, fail: () => null });
    const r2 = render(<App services={missing} router={createMemoryRouter(routes, { initialEntries: ['/share/does-not-exist#k'] })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This passport could not be found' })).toBeInTheDocument();
    r2.unmount();

    const noKey = createMockServices({ delayMs: 0, fail: () => null });
    const open = vi.spyOn(noKey.sharing, 'open');
    render(<App services={noKey} router={createMemoryRouter(routes, { initialEntries: ['/share/abc'] })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a link created on this device and renders the read-only passport', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    const passport = await services.visits.buildPassport('sample-profile-ramesh');
    const link = await services.sharing.create(passport, 2);
    const path = new URL(link.url).pathname + new URL(link.url).hash;
    renderAt(path, services);
    expect(await screen.findByRole('heading', { level: 1, name: 'Doctor Visit Passport' })).toBeInTheDocument();
    expect(screen.getByText('Shared Doctor Visit Passport · read-only')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share with QR' })).toBeNull();
  });
});
