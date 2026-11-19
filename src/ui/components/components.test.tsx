import '../test/configureTesting';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { IDS, sampleDocuments, sampleReviewItems } from '../../contract/fixtures/sampleCase';
import { pronounsFor } from '../lib/pronouns';
import { Button } from './Button';
import { Pill } from './Pill';
import { medicineStatusPill, reviewKindPill } from './pills';
import { ReviewCard } from './ReviewCard';

const item = (id: string) => sampleReviewItems.find((r) => r.id === id)!;

describe('Pill', () => {
  it('renders its words from a spec or children', () => {
    render(
      <>
        <Pill spec={medicineStatusPill('needs_confirmation')} />
        <Pill tone="blue">+ Added</Pill>
      </>,
    );
    expect(screen.getByText('Needs confirmation')).toBeInTheDocument();
    expect(screen.getByText('+ Added')).toBeInTheDocument();
  });

  it('maps a replaced medicine to "Replaced" and a stopped one to "Stopped"', () => {
    expect(medicineStatusPill({ status: 'stopped', replacedByMedicineId: 'x' }).label).toBe('Replaced');
    expect(medicineStatusPill({ status: 'stopped', replacedByMedicineId: null }).label).toBe('Stopped');
    expect(reviewKindPill('possible_duplicate')).toEqual({ tone: 'red', label: 'Possible duplicate ingredient' });
  });
});

describe('Button', () => {
  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while loading, and ignores clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link when given `to`', () => {
    render(
      <MemoryRouter>
        <Button to="/visit">Prepare for the visit</Button>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Prepare for the visit' })).toHaveAttribute('href', '/visit');
  });
});

describe('ReviewCard', () => {
  it('confirm_medicine: shows the question and resolves with the chosen answer', async () => {
    const onResolve = vi.fn();
    const onViewPrescriptions = vi.fn();
    render(
      <ReviewCard
        item={item(IDS.reviewItems.confirmAtorvastatin)}
        pronouns={pronounsFor('Father')}
        onResolve={onResolve}
        onViewPrescriptions={onViewPrescriptions}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Is he still taking Atorvastatin 10 mg?' })).toBeInTheDocument();
    expect(screen.getByText('Needs confirmation')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Still taking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ask the doctor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stopped' }));
    expect(onResolve.mock.calls.map((c) => c[0])).toEqual(['still_taking', 'ask_doctor', 'stopped']);

    await userEvent.click(screen.getByRole('button', { name: 'View both prescriptions' }));
    expect(onViewPrescriptions).toHaveBeenCalledTimes(1);
  });

  it('possible_duplicate: "Review both products" calls its handler', async () => {
    const onReviewProducts = vi.fn();
    render(<ReviewCard item={item(IDS.reviewItems.duplicateParacetamol)} onResolve={vi.fn()} onReviewProducts={onReviewProducts} />);
    expect(screen.getByText('Possible duplicate ingredient')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review both products' }));
    expect(onReviewProducts).toHaveBeenCalledTimes(1);
  });

  it('new_document: add, open and "Not his" actions', async () => {
    const onResolve = vi.fn();
    const onOpenDocument = vi.fn();
    const hba1c = sampleDocuments.find((d) => d.id === IDS.documents.hba1c)!;
    render(
      <ReviewCard
        item={item(IDS.reviewItems.newDocumentHba1c)}
        document={hba1c}
        pronouns={pronounsFor('Father')}
        onResolve={onResolve}
        onOpenDocument={onOpenDocument}
      />,
    );
    expect(screen.getByText('New report from email')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add to records' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open the PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not his' }));
    expect(onResolve.mock.calls.map((c) => c[0])).toEqual(['added', 'dismissed']);
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
  });

  it('disables the other answers while one is being saved', () => {
    render(<ReviewCard item={item(IDS.reviewItems.confirmAtorvastatin)} pending="ask_doctor" onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ask the doctor' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Still taking' })).toBeDisabled();
  });
});
