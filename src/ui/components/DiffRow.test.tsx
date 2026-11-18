import '../test/configureTesting';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expected } from '../../contract/fixtures/sampleCase';
import type { PrescriptionDiffRow } from '../../contract/types';
import { DiffRow } from './DiffRow';

const row = (kind: PrescriptionDiffRow['kind']) => expected.diffRows.find((r) => r.kind === kind)! as PrescriptionDiffRow;

describe('DiffRow', () => {
  it('added: blue pill, empty previous cell, latest medicine on the right', () => {
    render(<DiffRow row={row('added')} />);
    expect(screen.getByText('+ Added')).toBeInTheDocument();
    expect(screen.getByText(/Previous prescription:/).parentElement).toHaveTextContent('Not on this prescription');
    expect(screen.getByText(/Latest prescription:/).parentElement).toHaveTextContent('Rosuvastatin 10 mg');
    expect(screen.getByText(/Latest prescription:/).parentElement).toHaveTextContent('1 tablet, night');
  });

  it('changed: amber pill, old strength struck through, new strength highlighted', () => {
    const { container } = render(<DiffRow row={row('changed')} />);
    expect(screen.getByText('Changed strength')).toBeInTheDocument();
    const struck = container.querySelector('s');
    const marked = container.querySelector('mark');
    expect(struck).toHaveTextContent('5 mg');
    expect(marked).toHaveTextContent('10 mg');
    expect(screen.getByText(/Previous prescription:/).parentElement).toHaveTextContent('Amlodipine');
  });

  it('review: red pill, missing latest cell, the note and three answers', async () => {
    const onResolve = vi.fn();
    render(<DiffRow row={row('review')} onResolve={onResolve} />);
    expect(screen.getByText('Review required')).toBeInTheDocument();
    expect(screen.getByText(/Previous prescription:/).parentElement).toHaveTextContent('Atorvastatin 10 mg');
    expect(screen.getByText(/Latest prescription:/).parentElement).toHaveTextContent('Not on this prescription');
    expect(screen.getByText(/CareVault does not assume it was stopped/)).toBeInTheDocument();
    const card = screen.getByRole('article');
    for (const [label, resolution] of [
      ['Still taking', 'still_taking'],
      ['Stopped', 'stopped'],
      ['Ask the doctor', 'ask_doctor'],
    ] as const) {
      await userEvent.click(within(card).getByRole('button', { name: label }));
      expect(onResolve).toHaveBeenLastCalledWith(resolution);
    }
  });

  it('unchanged: grey pill, the same medicine in both cells, no buttons', () => {
    render(<DiffRow row={row('unchanged')} />);
    expect(screen.getByText('= Unchanged')).toBeInTheDocument();
    expect(screen.getByText(/Previous prescription:/).parentElement).toHaveTextContent('Telmisartan 40 mg');
    expect(screen.getByText(/Latest prescription:/).parentElement).toHaveTextContent('Telmisartan 40 mg');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('changed instructions get their own pill and markers', () => {
    const base = row('changed');
    const instructionOnly: PrescriptionDiffRow = { ...base, latest: { ...base.previous!, id: 'x', instruction: '1 tablet, night' } };
    const { container } = render(<DiffRow row={instructionOnly} />);
    expect(screen.getByText('Changed instructions')).toBeInTheDocument();
    expect(container.querySelector('s')).toHaveTextContent('1 tablet, morning');
    expect(container.querySelector('mark')).toHaveTextContent('1 tablet, night');
  });
});
