import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T09:00:00') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderAt(path: string, services = createMockServices({ delayMs: 0, fail: () => null })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

const section = (name: string) => screen.getByRole('region', { name });

describe('Settings', () => {
  it('has every section from the spec', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    for (const name of ['Profiles', 'Cloud reading', 'Import reports from Gmail', 'Backup', 'Sample data', 'About CareVault']) {
      expect(section(name)).toBeInTheDocument();
    }
    expect(within(section('About CareVault')).getByText(/not medical advice/)).toBeInTheDocument();
  });

  it('switches the cloud reading setting', async () => {
    const { services } = renderAt('/settings');
    const toggle = await screen.findByRole('switch', { name: /Send hard-to-read photos without asking/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(section('Cloud reading')).getByText(/Only that photo is sent/)).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect((await services.settings.get()).cloudReadingAllowed).toBe(true);
  });

  it('adds a profile and switches to it', async () => {
    const { services } = renderAt('/settings');
    await userEvent.click(within(await screen.findByRole('region', { name: 'Profiles' })).getByRole('button', { name: 'Add a profile' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a profile' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Lakshmi Iyer');
    await userEvent.type(within(sheet).getByLabelText('Relation to you'), 'Mother');
    await userEvent.type(within(sheet).getByLabelText('Your name'), 'Anjali Iyer');
    await userEvent.type(within(sheet).getByLabelText('Your relation to them'), 'daughter');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText('Profile for Lakshmi Iyer created and opened')).toBeInTheDocument();
    expect((await services.profiles.list()).map((p) => p.name)).toContain('Lakshmi Iyer');
    expect(await within(section('Profiles')).findByRole('button', { name: 'Switch to Ramesh Iyer' })).toBeInTheDocument();
  });

  it('connects Gmail, lists attachments with the session note, and imports one', async () => {
    const { services } = renderAt('/settings');
    const importSpy = vi.spyOn(services.gmail, 'importAttachment');
    const gmail = await screen.findByRole('region', { name: 'Import reports from Gmail' });
    expect(within(gmail).getByText(/Access lasts for this session only/)).toBeInTheDocument();
    await userEvent.click(within(gmail).getByRole('button', { name: 'Connect Gmail' }));
    const list = await within(gmail).findByRole('list', { name: 'Report attachments found' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(list).getByRole('button', { name: 'Import kidney-function-test-2026-11-13.pdf' }));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith(IDS.profile, 'mock-gmail-kidney-2026-11-13'));
    expect(await within(list).findByText('Added, waiting in Review')).toBeInTheDocument();
    expect((await services.review.listOpen(IDS.profile)).some((i) => i.title.includes('Kidney function test'))).toBe(true);
  });

  it('exports a backup with a confirmed passphrase', async () => {
    const createObjectURL = vi.fn(() => 'blob:backup');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const { services } = renderAt('/settings');
    const exportSpy = vi.spyOn(services.backup, 'export');
    const backup = await screen.findByRole('region', { name: 'Backup' });

    await userEvent.type(within(backup).getByLabelText('Passphrase'), 'short');
    await userEvent.click(within(backup).getByRole('button', { name: 'Save backup file' }));
    expect(within(backup).getByLabelText('Passphrase')).toHaveAccessibleDescription(/at least 8 characters/i);
    expect(exportSpy).not.toHaveBeenCalled();

    await userEvent.clear(within(backup).getByLabelText('Passphrase'));
    await userEvent.type(within(backup).getByLabelText('Passphrase'), 'green tea at nine');
    await userEvent.type(within(backup).getByLabelText('Passphrase again'), 'green tea at nine');
    await userEvent.click(within(backup).getByRole('button', { name: 'Save backup file' }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith('green tea at nine'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('restores a backup only after confirming it replaces the data, and reports a wrong passphrase', async () => {
    const { services } = renderAt('/settings');
    const blob = await services.backup.export('green tea at nine');
    const file = new File([await blob.text()], 'carevault-backup.cvbackup', { type: 'application/octet-stream' });
    const importSpy = vi.spyOn(services.backup, 'import');
    const backup = await screen.findByRole('region', { name: 'Backup' });

    await userEvent.upload(within(backup).getByTestId('file-input'), file);
    await userEvent.type(within(backup).getByLabelText('Passphrase of the backup'), 'wrong passphrase');
    await userEvent.click(within(backup).getByRole('button', { name: 'Restore backup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace all data on this device?' });
    expect(importSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace and restore' }));
    expect(await within(backup).findByText('The passphrase does not match this backup.')).toBeInTheDocument();

    await userEvent.clear(within(backup).getByLabelText('Passphrase of the backup'));
    await userEvent.type(within(backup).getByLabelText('Passphrase of the backup'), 'green tea at nine');
    await userEvent.click(within(backup).getByRole('button', { name: 'Restore backup' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Replace all data on this device?' })).getByRole('button', { name: 'Replace and restore' }));
    expect(await screen.findByText('The backup was restored on this device.')).toBeInTheDocument();
    expect(importSpy).toHaveBeenLastCalledWith(expect.any(File), 'green tea at nine');
  });

  it('loads the sample profile again', async () => {
    const { services } = renderAt('/settings');
    const load = vi.spyOn(services.profiles, 'loadSampleProfile');
    await userEvent.click(within(await screen.findByRole('region', { name: 'Sample data' })).getByRole('button', { name: 'Load the sample profile' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('The sample profile is open.')).toBeInTheDocument();
  });
});

describe('cloud reading setting in the scan flow', () => {
  it('when on, a hard-to-read photo is sent without the question, with the notice', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => 'cloud_consent' });
    await services.settings.setCloudReadingAllowed(true);
    const read = vi.spyOn(services.reading, 'read');
    renderAt('/medicines/scan', services);
    await screen.findByRole('heading', { level: 1, name: 'Scan a medicine' });
    await userEvent.upload(screen.getByTestId('file-input'), new File(['x'], 'pack.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText('Read by the cloud reader. Compare it with the photo.')).toBeInTheDocument();
    expect(read.mock.calls.map((c) => c[1])).toEqual([{ allowCloud: false }, { allowCloud: true }]);
    expect(screen.queryByText(/Send it to the cloud reader\?/)).toBeNull();
  });
});
