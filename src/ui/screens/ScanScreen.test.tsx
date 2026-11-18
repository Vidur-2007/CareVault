import '../test/configureTesting';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';

function renderScan(fail: string | null) {
  const services = createMockServices({ delayMs: 0, fail: () => fail });
  const read = vi.spyOn(services.reading, 'read');
  render(<App services={services} router={createMemoryRouter(routes, { initialEntries: ['/medicines/scan'] })} />);
  return { services, read };
}

const photo = () => new File(['pack'], 'dolo.jpg', { type: 'image/jpeg' });

async function choosePhoto() {
  await screen.findByRole('heading', { level: 1, name: 'Scan a medicine' });
  await userEvent.upload(screen.getByTestId('file-input'), photo());
}

describe('Scan a medicine', () => {
  it('reads on the device and goes to the confirm step with "Check this" markers', async () => {
    const { read } = renderScan(null);
    await choosePhoto();
    expect(await screen.findByRole('heading', { name: 'Check what was read' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toEqual({ allowCloud: false });
    expect(screen.getByLabelText('Product name')).toHaveValue('Dolo 650');
    expect(screen.getAllByText('Check this').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('How many per day')).toHaveAccessibleDescription(/not found on the pack/);
  });

  it('shows the consent panel on cloud_consent_required and sends nothing without a click', async () => {
    const { read } = renderScan('cloud_consent');
    await choosePhoto();

    expect(await screen.findByRole('heading', { name: 'This photo is hard to read on the device. Send it to the cloud reader?' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toEqual({ allowCloud: false });
    expect(read.mock.calls.some((c) => c[1].allowCloud)).toBe(false);
    expect(screen.getByRole('button', { name: 'Enter by hand' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send this photo' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read.mock.calls[1][1]).toEqual({ allowCloud: true });
    expect(await screen.findByText('Read by the cloud reader. Compare it with the photo.')).toBeInTheDocument();
  });

  it('shows the cloud notice while the photo is being sent', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => 'cloud_consent' });
    let release: () => void = () => {};
    const original = services.reading.read.bind(services.reading);
    vi.spyOn(services.reading, 'read').mockImplementation(async (file, opts) => {
      if (opts.allowCloud) await new Promise<void>((r) => (release = r));
      return original(file, opts);
    });
    render(<App services={services} router={createMemoryRouter(routes, { initialEntries: ['/medicines/scan'] })} />);
    await choosePhoto();
    await userEvent.click(await screen.findByRole('button', { name: 'Send this photo' }));
    expect((await screen.findAllByText('Sending this photo to the cloud reader')).length).toBeGreaterThan(0);
    release();
    expect(await screen.findByRole('heading', { name: 'Check what was read' })).toBeInTheDocument();
    expect(screen.queryByText('Sending this photo to the cloud reader')).toBeNull();
  });

  it('"Enter by hand" in the consent panel never sends the photo', async () => {
    const { read } = renderScan('cloud_consent');
    await choosePhoto();
    await userEvent.click(await screen.findByRole('button', { name: 'Enter by hand' }));
    expect(await screen.findByRole('heading', { name: 'Enter the medicine' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText('Check this')).toHaveLength(0);
  });

  it('saves the medicine, keeps the photo, and reports the new duplicate', async () => {
    const { services } = renderScan(null);
    await choosePhoto();
    await screen.findByRole('heading', { name: 'Check what was read' });
    await userEvent.type(screen.getByLabelText('How many per day'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save and confirm he takes it' }));

    expect(await screen.findByRole('heading', { name: 'Dolo 650 is saved' })).toBeInTheDocument();
    expect(screen.getByText('It is listed as a confirmed current medicine.')).toBeInTheDocument();
    expect(screen.getByText(/Dolo 650 and Crocin Advance 500 also contain paracetamol/)).toBeInTheDocument();

    const meds = await services.medicines.list(IDS.profile);
    const saved = meds.find((m) => m.productName === 'Dolo 650' && m.status === 'confirmed_current');
    expect(saved?.dosesPerDay).toBe(2);
    const docs = await services.documents.list(IDS.profile);
    expect(docs.find((d) => d.id === saved?.sourceDocumentId)?.title).toBe('Photo of Dolo 650');
  });

  it('shows an error with retry and "Enter by hand" when reading fails', async () => {
    renderScan('reading');
    await choosePhoto();
    expect(await screen.findByText('The photo could not be read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter by hand' })).toBeInTheDocument();
  });
});
