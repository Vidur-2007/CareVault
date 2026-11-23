import '../test/configureTesting';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Pill } from './Pill';
import { medicineStatusPill, reviewKindPill } from './pills';

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
