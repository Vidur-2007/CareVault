import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/legacy/fixtures/sampleCase';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';

const ATORVASTATIN_TITLE = 'Is he still taking Atorvastatin 10 mg?';

function renderReview(fail: string | null = null) {
  const services = createMockServices({ delayMs: 0, fail: () => fail });
  const resolve = vi.spyOn(services.review, 'resolve');
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(<App services={services} router={router} />);
  return { services, resolve, router };
}

/** Closing the toast ends the Undo window, which sends the held answer. */
async function closeToast() {
  await userEvent.click(await screen.findByRole('button', { name: 'Close message' }));
}

// The sample case is set on Saturday 14 November 2026, in the morning. Only Date is faked,
// so timers and user events run normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T09:00:00') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Review screen', () => {
  it('shows the three open items, the header sentence and the side panels', async () => {
    renderReview();
    expect(await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Two products at home contain paracetamol' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add this HbA1c report to his records?' })).toBeInTheDocument();
    expect(screen.getByText("Three things need your answer before your father's cardiology visit on Wednesday.")).toBeInTheDocument();
    expect(screen.getByText('3 open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Good morning, Anjali/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Since the last visit on 28 October' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wednesday, 18 November' })).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recently added records' });
    expect(within(recent).getAllByRole('article')).toHaveLength(3);
    expect(await within(recent).findByText(/2 medicine changes found/)).toBeInTheDocument();
  });

  it('"Still taking" removes the card and resolves the item once the Undo window ends', async () => {
    const { resolve } = renderReview();
    const card = (await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Still taking' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: ATORVASTATIN_TITLE })).toBeNull());
    expect(screen.getByText('Marked Atorvastatin 10 mg as still taken')).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();

    await closeToast();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.confirmAtorvastatin, 'still_taking', undefined));
    expect(await screen.findByText('2 open')).toBeInTheDocument();
  });

  it('"Stopped" asks for confirmation first, then resolves as stopped', async () => {
    const { resolve } = renderReview();
    const card = (await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Stopped' }));

    const dialog = await screen.findByRole('dialog', { name: 'Mark Atorvastatin 10 mg as stopped?' });
    expect(within(dialog).getByText('You can change this later.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as stopped' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: ATORVASTATIN_TITLE })).toBeNull());
    await closeToast();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.confirmAtorvastatin, 'stopped', undefined));
  });

  it('cancelling the "Stopped" dialog keeps the card', async () => {
    const { resolve } = renderReview();
    const card = (await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Stopped' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: ATORVASTATIN_TITLE })).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('"Add to records" resolves the email report as added', async () => {
    const { resolve } = renderReview();
    const card = (await screen.findByRole('heading', { name: 'Add this HbA1c report to his records?' })).closest('article')!;
    expect(within(card).getByText('New report from email')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Add to records' }));
    await closeToast();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(IDS.reviewItems.newDocumentHba1c, 'added', undefined));
  });

  it('Undo brings the card back and nothing is sent', async () => {
    const { resolve } = renderReview();
    const card = (await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Ask the doctor' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: ATORVASTATIN_TITLE })).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('shows the empty state when there are no open items', async () => {
    const services = createMockServices({ delayMs: 0, fail: () => null });
    for (const item of await services.review.listOpen(IDS.profile)) {
      await services.review.resolve(item.id, item.kind === 'new_document' ? 'added' : 'still_taking');
    }
    render(<App services={services} router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
    expect(await screen.findByRole('heading', { name: 'Nothing needs your review' })).toBeInTheDocument();
    expect(screen.getByText('Next visit: Wednesday, 18 November with Dr. Kavita Rao.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scan a medicine' })).toHaveAttribute('href', '/medicines/scan');
  });

  it('shows an error with Retry when the items cannot be loaded', async () => {
    renderReview('review');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Things to review could not be loaded')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
