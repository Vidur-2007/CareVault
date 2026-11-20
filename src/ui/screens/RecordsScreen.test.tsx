import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/legacy/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';
import { countByCategory, groupByMonth, matchPrescriber, validateDetails } from './records/recordsText';
import { sampleDocuments, samplePrescribers } from '../../contract/legacy/fixtures/sampleCase';

// Uploaded documents are dated "today"; keep it at the sample date.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T09:00:00') });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderAt(path: string) {
  const services = createMockServices({ delayMs: 0, fail: () => null });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

const cards = () => within(screen.getByRole('list', { name: 'Records' })).getAllByRole('article');
const pdf = (name = 'rx.pdf') => new File(['%PDF-1.4 synthetic prescription'], name, { type: 'application/pdf' });

async function openSheetAndUpload(file: File) {
  await userEvent.click(await screen.findByRole('button', { name: 'Add a record' }));
  const sheet = await screen.findByRole('dialog', { name: 'Add a record' });
  await userEvent.upload(within(sheet).getByTestId('file-input'), file);
}

describe('Records', () => {
  it('lists every record with category counts', async () => {
    renderAt('/records');
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(screen.getByRole('button', { name: 'All 6' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Prescriptions 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lab reports 2' })).toBeInTheDocument();
    expect(screen.getByText('Not yet confirmed')).toBeInTheDocument();
  });

  it('search filters the list', async () => {
    const { services } = renderAt('/records');
    const search = vi.spyOn(services.documents, 'search');
    await waitFor(() => expect(cards()).toHaveLength(6));
    await userEvent.type(screen.getByLabelText('Search records'), 'lipid');
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(cards()[0]).getByRole('heading', { name: 'Lipid profile' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith(IDS.profile, 'lipid');

    await userEvent.clear(screen.getByLabelText('Search records'));
    await userEvent.type(screen.getByLabelText('Search records'), 'nothing like this');
    expect(await screen.findByRole('heading', { name: 'No records match' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all records' }));
    await waitFor(() => expect(cards()).toHaveLength(6));
  });

  it('category chips and the starred toggle filter the list', async () => {
    renderAt('/records');
    await waitFor(() => expect(cards()).toHaveLength(6));
    await userEvent.click(screen.getByRole('button', { name: 'Lab reports 2' }));
    expect(cards()).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'All 6' }));
    await userEvent.click(within(cards()[0]).getByRole('button', { name: /^Star / }));
    await userEvent.click(screen.getByRole('button', { name: 'Starred only' }));
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('timeline groups by month and shows medicine changes on the latest prescription', async () => {
    renderAt('/records');
    await waitFor(() => expect(cards()).toHaveLength(6));
    await userEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeInTheDocument();
    expect(await screen.findByText(/2 medicine changes found/)).toBeInTheDocument();
  });

  it('shows the duplicate warning when add returns duplicateOf, and Discard removes the copy', async () => {
    const { services } = renderAt('/records');
    const original = services.documents.add.bind(services.documents);
    vi.spyOn(services.documents, 'add').mockImplementation(async (...args) => ({
      ...(await original(...args)),
      duplicateOf: IDS.documents.lipidProfile,
    }));
    const remove = vi.spyOn(services.documents, 'remove');

    await openSheetAndUpload(new File(['lab'], 'lipid.pdf', { type: 'application/pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Check the details' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Type'), 'lab_report');
    await userEvent.selectOptions(within(sheet).getByLabelText('Doctor'), '');
    await userEvent.clear(within(sheet).getByLabelText('Title'));
    await userEvent.type(within(sheet).getByLabelText('Title'), 'Lipid profile copy');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save to records' }));

    const warning = await screen.findByRole('alertdialog', { name: 'This looks like a file you already added on 12 Nov 2026' });
    await userEvent.click(within(warning).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('The copy was not kept.')).toBeInTheDocument();
  });

  it('confirming prescription lines calls prescriptions.apply with the edited values and opens the comparison', async () => {
    const { services, router } = renderAt('/records');
    const apply = vi.spyOn(services.prescriptions, 'apply');
    await openSheetAndUpload(pdf());

    const details = await screen.findByRole('dialog', { name: 'Check the details' });
    expect(within(details).getByText('Looks like a prescription from Dr. Kavita Rao dated 14 Nov 2026')).toBeInTheDocument();
    expect(within(details).getByLabelText('Title')).toHaveValue('Cardiology prescription');
    await userEvent.click(within(details).getByRole('button', { name: 'Save and check the medicines' }));

    const step = await screen.findByRole('dialog', { name: 'Check the medicines on this prescription' });
    const lines = within(step).getAllByRole('article');
    expect(lines).toHaveLength(3);

    // Edit line 1's strength, remove line 3, add a typed line.
    const strength = within(lines[0]).getByLabelText('Strength');
    await userEvent.clear(strength);
    await userEvent.type(strength, '5');
    await userEvent.click(within(lines[2]).getByRole('button', { name: 'Remove line 3' }));
    await userEvent.click(within(step).getByRole('button', { name: 'Add a line' }));
    const added = within(step).getAllByRole('article')[2];
    await userEvent.type(within(added).getByLabelText('Product name'), 'Aspirin 75 mg');
    await userEvent.type(within(added).getByLabelText('Ingredient'), 'Aspirin');
    await userEvent.type(within(added).getByLabelText('Strength'), '75');
    await userEvent.type(within(added).getByLabelText('How many per day'), '1');
    await userEvent.type(within(added).getByLabelText('How it is taken'), '1 tablet, after lunch');
    await userEvent.click(within(step).getByRole('button', { name: 'Save and compare' }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const [profileId, documentId, prescriberId, sent] = apply.mock.calls[0];
    expect(profileId).toBe(IDS.profile);
    expect(typeof documentId).toBe('string');
    expect(prescriberId).toBe(IDS.prescribers.rao);
    expect(sent).toEqual([
      { productName: 'Amlodipine 10 mg', ingredients: [{ name: 'amlodipine', strength: 5, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
      { productName: 'Telmisartan 40 mg', ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
      { productName: 'Aspirin 75 mg', ingredients: [{ name: 'aspirin', strength: 75, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, after lunch', warnings: [] },
    ]);

    await waitFor(() => expect(router.state.location.pathname).toBe('/visit'));
    expect(await screen.findByRole('heading', { level: 1, name: 'What changed since the last visit' })).toBeInTheDocument();
    expect((await screen.findAllByText('+ Added')).length).toBeGreaterThan(0);
  });

  it('a line with an invalid value blocks apply and focuses the field', async () => {
    const { services } = renderAt('/records');
    const apply = vi.spyOn(services.prescriptions, 'apply');
    await openSheetAndUpload(pdf('rx2.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Save and check the medicines' }));
    const step = await screen.findByRole('dialog', { name: 'Check the medicines on this prescription' });
    const strength = within(within(step).getAllByRole('article')[1]).getByLabelText('Strength');
    await userEvent.clear(strength);
    await userEvent.click(within(step).getByRole('button', { name: 'Save and compare' }));
    expect(strength).toHaveFocus();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('Document detail', () => {
  it('shows metadata, stars, and confirms a pending email report through its review item', async () => {
    const { services } = renderAt(`/records/${IDS.documents.hba1c}`);
    const resolve = vi.spyOn(services.review, 'resolve');
    expect(await screen.findByRole('heading', { level: 1, name: 'HbA1c report' })).toBeInTheDocument();
    expect(screen.getByText('PDF from email, 12 Nov 2026')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(await screen.findByRole('button', { name: 'Starred' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm this record' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.newDocumentHba1c, 'added'));
    expect((await services.documents.get(IDS.documents.hba1c)).state).toBe('confirmed');
  });

  it('has page and zoom controls, and the lines of a prescription', async () => {
    renderAt(`/records/${IDS.documents.raoLatest}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Cardiology prescription' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(await screen.findByText('Rosuvastatin 10 mg')).toBeInTheDocument();
  });

  it('deletes after confirmation and returns to Records', async () => {
    const { services, router } = renderAt(`/records/${IDS.documents.ecg}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete this record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete ECG report?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/records'));
    await expect(services.documents.get(IDS.documents.ecg)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('records text', () => {
  it('counts, groups and matches', () => {
    expect(countByCategory(sampleDocuments)).toMatchObject({ all: 6, prescription: 3, lab_report: 2, test: 1 });
    expect(groupByMonth(sampleDocuments).map((g) => g.label)).toEqual(['November 2026', 'October 2026', 'September 2026', 'August 2026', 'July 2026']);
    expect(matchPrescriber('Dr. K. Rao', samplePrescribers)?.name).toBe('Dr. Kavita Rao');
    expect(matchPrescriber('Dr. Someone Else', samplePrescribers)).toBeNull();
  });

  it('requires a doctor for a prescription and rejects future dates', () => {
    expect(validateDetails({ type: 'prescription', title: 'Rx', documentDate: '2026-11-14', prescriberId: '' }, '2026-11-14').prescriberId).toBeDefined();
    expect(validateDetails({ type: 'lab_report', title: 'Lab', documentDate: '2026-12-01', prescriberId: '' }, '2026-11-14').documentDate).toBeDefined();
    expect(validateDetails({ type: 'lab_report', title: 'Lab', documentDate: '2026-11-01', prescriberId: '' }, '2026-11-14')).toEqual({});
  });
});
