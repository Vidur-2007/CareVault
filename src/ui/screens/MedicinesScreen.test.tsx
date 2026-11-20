import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { IDS, sampleEvents, sampleMedicines } from '../../contract/legacy/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';
import { lastChange, stoppedText } from './medicines/medicineText';

function renderAt(path: string, fail: string | null = null) {
  const services = createMockServices({ delayMs: 0, fail: () => fail });
  render(<App services={services} router={createMemoryRouter(routes, { initialEntries: [path] })} />);
  return services;
}

describe('Medicines screen', () => {
  it('matches the mockup sections and counts', async () => {
    renderAt('/medicines');
    expect(await screen.findByRole('heading', { level: 1, name: 'Medicines' })).toBeInTheDocument();
    expect(screen.getByText(/counts as current only after you confirm he takes it/)).toBeInTheDocument();
    expect(await screen.findByText('4 Confirmed current')).toBeInTheDocument();
    expect(screen.getByText('1 Needs confirmation')).toBeInTheDocument();
    expect(await screen.findByText('1 Possible duplicate')).toBeInTheDocument();
    expect(screen.getByText('2 Previous or stopped')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Paracetamol appears in two products' })).toBeInTheDocument();
    expect(screen.getByTestId('duplicate-total')).toHaveTextContent('3,450 mg a day');

    const needs = screen.getByRole('region', { name: 'Needs confirmation' });
    expect(within(needs).getByText(/not on Dr\. Rao's prescription of 28 Oct/)).toBeInTheDocument();

    const current = screen.getByRole('region', { name: 'Confirmed current' });
    const table = within(current).getByRole('table');
    expect(await within(table).findByText('5 mg to 10 mg, 28 Oct')).toBeInTheDocument();
    expect(within(table).getByText('Added 28 Oct')).toBeInTheDocument();
    expect(within(table).getByText('No change since 5 Aug')).toBeInTheDocument();
    expect(within(table).getByText('No change since 14 Jul')).toBeInTheDocument();

    const stopped = screen.getByRole('region', { name: 'Previous or stopped' });
    expect(within(stopped).getByText('Replaced by the 10 mg strength on 28 Oct 2026')).toBeInTheDocument();
    expect(within(stopped).getByText('Marked stopped by you on 5 Aug 2026')).toBeInTheDocument();
  });

  it('"Still taking" on a needs-confirmation medicine resolves its review item', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    const resolve = vi.spyOn(services.review, 'resolve');
    render(<App services={services} router={createMemoryRouter(routes, { initialEntries: ['/medicines'] })} />);
    const needs = await screen.findByRole('region', { name: 'Needs confirmation' });
    await userEvent.click(within(needs).getByRole('button', { name: 'Still taking' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close message' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.confirmAtorvastatin, 'still_taking', undefined));
  });

  it('"He only takes one of these" keeps the chosen product and stops the other', async () => {
    const services = renderAt('/medicines');
    await userEvent.click(await screen.findByRole('button', { name: 'He only takes one of these' }));
    const dialog = await screen.findByRole('dialog', { name: 'Which one does he take?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Crocin Advance 500' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await services.medicines.get(IDS.medicines.dolo650)).status).toBe('stopped'));
    expect((await services.medicines.get(IDS.medicines.crocinAdvance500)).status).toBe('found_at_home');
  });

  it('shows an error with retry', async () => {
    renderAt('/medicines', 'medicines');
    expect(await screen.findByText('Medicines could not be loaded')).toBeInTheDocument();
  });
});

describe('Medicine detail', () => {
  it('shows the details, source and history timeline', async () => {
    renderAt(`/medicines/${IDS.medicines.amlodipine10}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Amlodipine 10 mg' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Cardiology prescription, 28 Oct 2026' })).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'History' });
    expect(await within(history).findByText('Strength changed')).toBeInTheDocument();
    expect(within(history).getByText(/5 mg to 10 mg/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as stopped' })).toBeInTheDocument();
  });

  it('marks a medicine as stopped after confirmation', async () => {
    const services = renderAt(`/medicines/${IDS.medicines.telmisartan40}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as stopped' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark Telmisartan 40 mg as stopped?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as stopped' }));
    await waitFor(async () => expect((await services.medicines.get(IDS.medicines.telmisartan40)).status).toBe('stopped'));
    expect(await screen.findByText('Marked as stopped')).toBeInTheDocument();
  });

  it('says when a medicine does not exist', async () => {
    renderAt('/medicines/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Medicine not found' })).toBeInTheDocument();
  });
});

describe('medicine text', () => {
  it('last change uses the date of the last visit', () => {
    const events = sampleEvents.filter((e) => e.medicineId === IDS.medicines.amlodipine10);
    expect(lastChange(events, '2026-10-28')).toEqual({ kind: 'changed', text: '5 mg to 10 mg, 28 Oct' });
    expect(lastChange(events, null)).toEqual({ kind: 'none', text: 'No change since 28 Oct' });
  });

  it('stopped text names a replacement by strength', () => {
    const amlo5 = sampleMedicines.find((m) => m.id === IDS.medicines.amlodipine5)!;
    expect(stoppedText(amlo5, sampleMedicines)).toBe('Replaced by the 10 mg strength on 28 Oct 2026');
  });
});
