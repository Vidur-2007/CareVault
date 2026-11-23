import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { eventChanges, sourceLabel, undoable } from './passport/passportText';
import { validateMedicine, EMPTY_MEDICINE } from './passport/medicineValues';

const M = IDS.medicines;

function renderMedicine(id: string, opts: { services?: CareVaultServices; fail?: () => string | null } = {}) {
  const services = opts.services ?? createMockServicesV2({ delayMs: 0, fail: opts.fail ?? (() => null) });
  const router = createMemoryRouter(routes, { initialEntries: [`/passport/medicines/${id}`] });
  render(<App services={services} router={router} />);
  return { services, router };
}

const history = () => screen.getByRole('list', { name: 'History, newest first' });
const row = (label: string) => within(screen.getByRole('region', { name: 'Details' })).getByText(label).nextElementSibling;

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('medicine detail', () => {
  it('shows the fields, source record and history with before and after values', async () => {
    renderMedicine(M.amlodipine5);
    expect(await screen.findByRole('heading', { level: 1, name: 'Amlodipine 5 mg' })).toBeInTheDocument();
    expect(document.title).toBe('Amlodipine 5 mg · CareVault');
    // The status pill sits under the heading (the history also says "Replaced").
    expect(within(screen.getByRole('heading', { level: 1 }).parentElement!).getByText('Replaced')).toBeInTheDocument();
    expect(row('Source')).toHaveTextContent('Reported by Anjali');
    expect(row('Doctor')).toHaveTextContent('Dr. Kavita Rao, Cardiology');
    expect(await within(row('Source record') as HTMLElement).findByRole('link', { name: 'Cardiology prescription, 5 Aug 2026' })).toHaveAttribute('href', `/records/${IDS.documents.raoPrevious}`);
    expect(await within(row('Replaced by') as HTMLElement).findByRole('link', { name: 'Amlodipine 10 mg' })).toBeInTheDocument();
    const items = within(await screen.findByRole('list', { name: 'History, newest first' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Replaced');
    expect(within(items[0]).getByRole('row', { name: 'Status taking stopped' })).toBeInTheDocument();
    expect(items.at(-1)).toHaveTextContent('Added');
  });

  it('asks before a status change that hides the medicine, then records it', async () => {
    const { services } = renderMedicine(M.metformin500);
    await screen.findByRole('heading', { level: 1, name: 'Metformin 500 mg' });
    await userEvent.click(screen.getByRole('button', { name: 'Stopped' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark Metformin 500 mg as stopped?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect((await services.routine.get(M.metformin500)).status).toBe('taking');

    await userEvent.click(screen.getByRole('button', { name: 'Stopped' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark as stopped' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stopped' })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(within(history()).getAllByRole('listitem')[0]).toHaveTextContent('Stopped'));
    expect(within(within(history()).getAllByRole('listitem')[0]).getByRole('row', { name: 'Status taking stopped' })).toBeInTheDocument();
    // "Not sure" needs no confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Not sure' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not sure' })).toHaveAttribute('aria-pressed', 'true'));
    expect((await services.routine.get(M.metformin500)).status).toBe('uncertain');
  });

  it('undoes the latest change', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    await services.routine.setStatus(M.dolo650, 'stopped');
    renderMedicine(M.dolo650, { services });
    await screen.findByRole('heading', { level: 1, name: 'Dolo 650' });
    expect(screen.getByRole('button', { name: 'Stopped' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(await screen.findByRole('button', { name: 'Undo the latest change' }));
    expect(await screen.findByText('Undone: Marked as stopped')).toBeInTheDocument();
    expect((await services.routine.get(M.dolo650)).status).toBe('taking');
    await waitFor(() => expect(within(history()).getAllByRole('listitem')[0]).toHaveTextContent('Undone'));
    // An undo is not undone again from here.
    expect(screen.queryByRole('button', { name: 'Undo the latest change' })).toBeNull();
  });

  it('says so when Undo is refused because a later change was made', async () => {
    let fail: string | null = null;
    const services = createMockServicesV2({ delayMs: 0, fail: () => fail });
    await services.routine.setStatus(M.crocinAdvance500, 'stopped');
    renderMedicine(M.crocinAdvance500, { services });
    const undo = await screen.findByRole('button', { name: 'Undo the latest change' });
    fail = 'stale';
    await userEvent.click(undo);
    expect(await screen.findByRole('alert')).toHaveTextContent('A later change was made; see the history.');
    fail = null;
    expect((await services.routine.get(M.crocinAdvance500)).status).toBe('stopped');
  });

  it('edits the entry, and undoes the edit', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const added = await services.routine.add(IDS.ramesh, {
      productName: 'Shelcal 500', ingredients: [{ name: 'calcium', strength: 500, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '',
    }, { status: 'taking', source: 'caregiver_reported', documentId: null });
    const { router } = renderMedicine(added.id, { services });
    await screen.findByRole('heading', { level: 1, name: 'Shelcal 500' });
    expect(row('Source record')).toHaveTextContent('None');

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Shelcal 500' });
    await userEvent.clear(within(dialog).getByLabelText('Doses a day (optional)'));
    await userEvent.type(within(dialog).getByLabelText('Doses a day (optional)'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    await waitFor(() => expect(within(within(history()).getAllByRole('listitem')[0]).getByRole('row', { name: 'Doses a day 1 2' })).toBeInTheDocument());

    // Undo the edit, then undo the addition.
    await userEvent.click(screen.getByRole('button', { name: 'Undo the latest change' }));
    await waitFor(async () => expect((await services.routine.get(added.id)).dosesPerDay).toBe(1));
    // The latest change is now that undo, which is not undone again; the addition stays in the history.
    expect(screen.queryByRole('button', { name: 'Undo the latest change' })).toBeNull();
    expect(router.state.location.pathname).toBe(`/passport/medicines/${added.id}`);
  });

  it('Undo of a medicine added by hand removes it and returns to the passport', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const added = await services.routine.add(IDS.ramesh, {
      productName: 'Shelcal 500', ingredients: [{ name: 'calcium', strength: 500, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '',
    }, { status: 'taking', source: 'caregiver_reported', documentId: null });
    const { router } = renderMedicine(added.id, { services });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo the latest change' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/passport'));
    await expect(services.routine.get(added.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('handles a removed source record and another profile’s medicine', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    await services.documents.remove(IDS.documents.menon);
    renderMedicine(M.metformin500, { services });
    await screen.findByRole('heading', { level: 1, name: 'Metformin 500 mg' });
    expect(await within(row('Source record') as HTMLElement).findByText('The source record was removed')).toBeInTheDocument();
  });

  it('never shows another profile’s medicine', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    renderMedicine(M.dolo650);
    expect(await screen.findByRole('heading', { level: 1, name: 'Medicine not found' })).toBeInTheDocument();
  });
});

describe('passport helpers', () => {
  it('words sources, changes and the undoable event', () => {
    const profile = { name: 'Ramesh Iyer', caregiverName: 'Anjali Iyer' };
    expect(sourceLabel({ source: 'caregiver_reported' }, profile)).toBe('Reported by Anjali');
    expect(sourceLabel({ source: 'patient_reported' }, profile)).toBe('Reported by Ramesh');
    expect(sourceLabel({ source: 'from_prescription' }, profile)).toBe('From a prescription');
    expect(sourceLabel({ source: 'from_pack' }, profile)).toBe('From the pack');
    const base = { productName: 'X', ingredients: [], dosesPerDay: 1, instruction: '', status: 'taking' } as never;
    expect(eventChanges({ before: base, after: { ...(base as object), dosesPerDay: 2 } as never })).toEqual([{ label: 'Doses a day', before: '1', after: '2' }]);
    expect(undoable([])).toBeNull();
    expect(undoable([{ id: 'a', type: 'stopped' } as never, { id: 'b', type: 'undone', undoesEventId: 'a' } as never])).toBeNull();
  });

  it('validates a medicine typed by hand', () => {
    expect(validateMedicine(EMPTY_MEDICINE).errors.productName).toBeDefined();
    const ok = validateMedicine({ ...EMPTY_MEDICINE, productName: ' Dolo  650 ', ingredients: [{ name: 'Paracetamol', strength: '650', unit: 'mg' }], dosesPerDay: '3' });
    expect(ok.input).toEqual({ productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }], form: 'tablet', dosesPerDay: 3, instruction: '' });
    expect(validateMedicine({ ...EMPTY_MEDICINE, productName: 'X', ingredients: [{ name: 'a', strength: 'x', unit: 'mg' }] }).errors.ingredients?.[0]?.strength).toBeDefined();
    // An empty ingredient row is dropped: a name alone is enough.
    expect(validateMedicine({ ...EMPTY_MEDICINE, productName: 'Some syrup' }).input?.ingredients).toEqual([]);
  });
});
