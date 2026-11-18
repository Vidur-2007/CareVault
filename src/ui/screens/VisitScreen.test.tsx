import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import { ServiceError } from '../../contract/types';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';
import { orderRows, unansweredCount } from './visit/visitText';
import { expected, sampleReviewItems } from '../../contract/fixtures/sampleCase';
import type { PrescriptionDiffRow } from '../../contract/types';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T09:00:00') });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderAt(path: string, services = createMockServices({ delayMs: 0, fail: () => null })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

describe('Visit, appointment mode', () => {
  it('matches the mockup: pill, date tiles, rows in order, side column', async () => {
    renderAt('/visit');
    expect(await screen.findByText('Appointment mode · Wednesday, 18 Nov, 10:30 am')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'What changed since the last visit' })).toBeInTheDocument();
    expect(screen.getByText(/Comparing Dr\. Kavita Rao’s two prescriptions/)).toBeInTheDocument();
    expect(await screen.findByText('5 August 2026')).toBeInTheDocument();
    expect(screen.getByText('28 October 2026')).toBeInTheDocument();

    const list = screen.getByRole('region', { name: 'Prescription comparison' });
    const pills = within(list)
      .getAllByRole('article')
      .map((a) => a.querySelector('span')?.textContent);
    expect(pills).toEqual(['+ Added', 'Changed strength', 'Review required', '= Unchanged']);
    expect(within(list).getByText('CareVault does not assume it was stopped. Please confirm what he is taking.')).toBeInTheDocument();

    const questions = screen.getByRole('region', { name: 'Questions for the doctor' });
    expect(within(questions).getAllByRole('listitem')).toHaveLength(2);
    const reports = screen.getByRole('region', { name: 'Reports to share' });
    expect(within(reports).getByRole('checkbox', { name: 'Lipid profile, 12 Nov' })).toBeChecked();
    expect(within(reports).getByRole('checkbox', { name: 'ECG report, 15 Sep' })).toBeChecked();
    expect(within(reports).getByRole('checkbox', { name: 'HbA1c report, 12 Nov (not yet confirmed)' })).toBeDisabled();
    expect(screen.getAllByText('1 item still needs your answer')).toHaveLength(2); // side panel and phone bar
    expect(screen.getByRole('link', { name: 'Open the Doctor Visit Passport' })).toHaveAttribute('href', '/visit/passport');
  });

  it('answering a review row updates the status panel count', async () => {
    const { services } = renderAt('/visit');
    const resolve = vi.spyOn(services.review, 'resolve');
    expect((await screen.findAllByText('1 item still needs your answer')).length).toBe(2);

    const review = (await screen.findByText('Review required')).closest('article')!;
    await userEvent.click(within(review).getByRole('button', { name: 'Ask the doctor' }));

    expect(screen.getAllByText('Everything is answered')).toHaveLength(2);
    expect(screen.queryByText('1 item still needs your answer')).toBeNull();
    expect(within(review).queryByRole('button', { name: 'Ask the doctor' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Close message' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.confirmAtorvastatin, 'ask_doctor', undefined));
    expect(screen.getAllByText('Everything is answered')).toHaveLength(2);
  });

  it('adds and removes questions, and changes the shared reports', async () => {
    const { services } = renderAt('/visit');
    const questions = await screen.findByRole('region', { name: 'Questions for the doctor' });
    await userEvent.type(within(questions).getByLabelText('Add your own question'), 'Should the ECG be repeated?');
    await userEvent.click(within(questions).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(within(questions).getAllByRole('listitem')).toHaveLength(3));
    await userEvent.click(within(questions).getByRole('button', { name: 'Remove question: Should the ECG be repeated?' }));
    await waitFor(() => expect(within(questions).getAllByRole('listitem')).toHaveLength(2));

    await userEvent.click(within(screen.getByRole('region', { name: 'Reports to share' })).getByRole('checkbox', { name: 'ECG report, 15 Sep' }));
    await waitFor(async () => expect((await services.visits.next(IDS.profile))?.sharedDocumentIds).toEqual([IDS.documents.lipidProfile]));
  });

  it('with no next visit, offers a form to add one', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    vi.spyOn(services.visits, 'next').mockResolvedValue(null);
    const save = vi.spyOn(services.visits, 'save');
    renderAt('/visit', services);
    expect(await screen.findByRole('heading', { name: 'No visit is planned yet' })).toBeInTheDocument();
    expect(screen.queryByText(/Appointment mode/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Date'), '2026-12-02');
    await userEvent.click(screen.getByRole('button', { name: 'Add the visit' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ profileId: IDS.profile, prescriberId: IDS.prescribers.rao, questions: [], sharedDocumentIds: [] });
    expect(save.mock.calls[0][0].at).toMatch(/^2026-12-02T10:00:00[+-]\d{2}:\d{2}$/);
  });

  it('explains a first prescription with no previous one', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    vi.spyOn(services.prescriptions, 'latestDiff').mockResolvedValue({
      prescriberId: IDS.prescribers.rao,
      previousDocumentId: null,
      latestDocumentId: IDS.documents.raoLatest,
      rows: expected.diffRows.filter((r) => r.latest).map((r) => ({ ...r, kind: 'added' as const, previous: null })) as PrescriptionDiffRow[],
    });
    renderAt('/visit', services);
    expect(await screen.findByText(/This is the first prescription from Dr\. Kavita Rao in CareVault/)).toBeInTheDocument();
    expect(screen.getByText('No earlier prescription in CareVault')).toBeInTheDocument();
    expect(screen.getAllByText('+ Added')).toHaveLength(3);
  });

  it('shows an error when the visit cannot be loaded', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    vi.spyOn(services.visits, 'next').mockRejectedValue(new ServiceError('network', 'Offline'));
    renderAt('/visit', services);
    expect(await screen.findByText('The next visit could not be loaded')).toBeInTheDocument();
  });
});

describe('visit text', () => {
  it('orders rows and counts unanswered review rows', () => {
    const shuffled = [...expected.diffRows].reverse() as PrescriptionDiffRow[];
    expect(orderRows(shuffled).map((r) => r.kind)).toEqual(['added', 'changed', 'review', 'unchanged']);
    expect(unansweredCount(shuffled, sampleReviewItems, new Set())).toBe(1);
    expect(unansweredCount(shuffled, sampleReviewItems, new Set([IDS.reviewItems.confirmAtorvastatin]))).toBe(0);
    expect(unansweredCount(shuffled, [], new Set())).toBe(0);
  });
});
