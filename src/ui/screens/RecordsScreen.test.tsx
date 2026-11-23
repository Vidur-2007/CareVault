import '../test/configureTesting';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';

function renderRecords(fail: string | null = null) {
  const services = createMockServicesV2({ delayMs: 0, fail: () => fail });
  const router = createMemoryRouter(routes, { initialEntries: ['/records'] });
  render(<App services={services} router={router} />);
  return { services, router };
}

/** The titles in the grid, in order. */
async function gridTitles() {
  const list = await screen.findByRole('list', { name: 'Records' });
  return within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
}

/** Waits until the grid shows exactly these titles (the search runs after a short pause). */
async function expectTitles(titles: string[]) {
  await expect.poll(gridTitles, { timeout: 4000 }).toEqual(titles);
}

afterEach(() => {
  localStorage.removeItem('cv.recordsView');
  localStorage.removeItem('cv.profileId');
});

const ALL_NEWEST = ['Lipid profile', 'Cardiology prescription', 'ECG report', 'Cardiology prescription', 'Diabetes prescription', 'HbA1c report'];

describe('Records: search and filters', () => {
  it('lists every record newest first, undated last, with its source', async () => {
    renderRecords();
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    await expectTitles(ALL_NEWEST);
    expect(document.title).toBe('Records · CareVault');
    expect(screen.getByText(/12 Nov 2026 · uploaded PDF/)).toBeInTheDocument();
    expect(screen.getByText(/Added 12 Nov 2026 · PDF from email/)).toBeInTheDocument();
    expect(screen.getAllByText(/scanned with the camera/)).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Add a record' })).toHaveAttribute('href', '/records/add');
  });

  it('searches by test, and says what matched', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.type(screen.getByLabelText('Search records'), 'HbA1c');
    await expectTitles(['HbA1c report']);
    expect(screen.getByText('Matched: title, test name')).toBeInTheDocument();
  });

  it('filters by doctor', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.selectOptions(screen.getByLabelText('Doctor'), 'Dr. Kavita Rao, Cardiology');
    await expectTitles(['Cardiology prescription', 'Cardiology prescription']);
    expect(screen.getAllByText('Matched: doctor')).toHaveLength(2);
    // Text also finds a doctor by specialty.
    await userEvent.selectOptions(screen.getByLabelText('Doctor'), 'Any doctor');
    await userEvent.type(screen.getByLabelText('Search records'), 'diabetology');
    await expectTitles(['Diabetes prescription']);
    expect(screen.getByText('Matched: tag, specialty')).toBeInTheDocument();
  });

  it('filters by facility', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.selectOptions(screen.getByLabelText('Facility'), 'Lakeside Diagnostics');
    await expectTitles(['Lipid profile', 'ECG report', 'HbA1c report']);
    expect(screen.getAllByText('Matched: facility')).toHaveLength(3);
  });

  it('filters by date range, leaving undated records out', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    await expectTitles(['Cardiology prescription', 'ECG report']);
    expect(screen.getAllByText('Matched: date')).toHaveLength(2);
    expect(screen.getByText(/no known date are left out/)).toBeInTheDocument();
  });

  it('filters by kind with counts, by star, and sorts oldest first', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.click(screen.getByRole('button', { name: 'Lab reports 2' }));
    await expectTitles(['Lipid profile', 'HbA1c report']);
    await userEvent.click(screen.getByRole('button', { name: 'Lab reports 2' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Oldest first' }));
    await expectTitles(['Diabetes prescription', 'Cardiology prescription', 'ECG report', 'Cardiology prescription', 'Lipid profile', 'HbA1c report']);

    await userEvent.click(screen.getByRole('button', { name: 'Star Lipid profile' }));
    expect(await screen.findByRole('button', { name: 'Unstar Lipid profile' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Starred' }));
    await expectTitles(['Lipid profile']);
  });

  it('offers Ask for a question-like phrase, and clears an empty search', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.type(screen.getByLabelText('Search records'), 'latest lipid profile');
    expect(await screen.findByRole('link', { name: 'Ask CareVault: “latest lipid profile”' })).toHaveAttribute('href', '/ask?q=latest%20lipid%20profile');

    await userEvent.clear(screen.getByLabelText('Search records'));
    await userEvent.type(screen.getByLabelText('Search records'), 'zzz');
    expect(await screen.findByRole('heading', { name: 'No records match' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search and filters' }));
    await expectTitles(ALL_NEWEST);
  });
});

describe('Records: timeline', () => {
  it('groups by month and puts undated records in their own final group', async () => {
    renderRecords();
    await expectTitles(ALL_NEWEST);
    await userEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
    const region = await screen.findByRole('region', { name: 'Records by month' });
    expect(within(region).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'November 2026', 'October 2026', 'September 2026', 'August 2026', 'July 2026', 'Date not known',
    ]);
    const undated = within(region).getByRole('heading', { name: 'Date not known' }).closest('section')!;
    expect(within(undated).getByRole('link', { name: 'HbA1c report' })).toHaveAttribute('href', `/records/${IDS.documents.hba1c}`);
    expect(within(undated).getByText('Added 12 Nov from email')).toBeInTheDocument();
    expect(within(undated).getByText(/Lab report · PDF from email · not yet filed/)).toBeInTheDocument();

    // Oldest first still keeps the undated group last.
    await userEvent.click(screen.getByRole('radio', { name: 'Oldest first' }));
    await expect.poll(() => within(screen.getByRole('region', { name: 'Records by month' })).getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'Date not known']);
    expect(localStorage.getItem('cv.recordsView')).toBe('timeline');
  });
});

describe('Records: states', () => {
  it('shows an error with Retry', async () => {
    renderRecords('documents');
    expect(await screen.findByText('Records could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeInTheDocument();
  });

  it('shows the empty state for a profile with no records', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const p = await services.profiles.create({
      name: 'Meera Nair', relation: 'Myself', birthYear: null, caregiverName: '', caregiverRelation: '', emergencyContact: null,
    });
    localStorage.setItem('cv.profileId', p.id);
    render(<App services={services} router={createMemoryRouter(routes, { initialEntries: ['/records'] })} />);
    expect(await screen.findByRole('heading', { name: 'No records yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add the first record' })).toHaveAttribute('href', '/records/add');
  });
});
