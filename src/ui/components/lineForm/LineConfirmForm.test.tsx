import '../../test/configureTesting';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ExtractedLine } from '../../../contract/types';
import { LineConfirmForm } from './LineConfirmForm';
import { validateDraft, draftFromLine, warningsByField } from './lineDraft';

const dolo: ExtractedLine = {
  productName: 'Dolo 650',
  ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }],
  form: 'tablet',
  dosesPerDay: null,
  instruction: '',
  warnings: ['How often it is taken was not found on the pack.', 'Strength not found in drug reference'],
};

const actions = [
  { id: 'home', label: 'Save as found at home', variant: 'secondary' as const },
  { id: 'confirm', label: 'Save and confirm he takes it' },
];

const markers = () => screen.queryAllByText('Check this');

describe('LineConfirmForm', () => {
  it('marks every extracted field and shows warnings under their fields', () => {
    render(<LineConfirmForm line={dolo} fromExtraction actions={actions} onSubmit={vi.fn()} />);
    // product name, ingredient, strength, unit, form, per day, instruction
    expect(markers()).toHaveLength(7);
    expect(screen.getByLabelText('How many per day')).toHaveAccessibleDescription(/How often it is taken was not found on the pack\./);
    expect(screen.getByLabelText('Strength')).toHaveAccessibleDescription(/Strength not found in drug reference/);
  });

  it('clears the marker of a field when it is edited', async () => {
    render(<LineConfirmForm line={dolo} fromExtraction actions={actions} onSubmit={vi.fn()} />);
    const name = screen.getByLabelText('Product name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Dolo-650');
    expect(markers()).toHaveLength(6);
    await userEvent.type(screen.getByLabelText('How many per day'), '3');
    expect(markers()).toHaveLength(5);
  });

  it('clears every marker when the caregiver confirms all fields', async () => {
    render(<LineConfirmForm line={dolo} fromExtraction actions={actions} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Everything matches the original' }));
    expect(markers()).toHaveLength(0);
  });

  it('clears the markers and submits a clean line when saved', async () => {
    const onSubmit = vi.fn();
    render(<LineConfirmForm line={dolo} fromExtraction actions={actions} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('How many per day'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save and confirm he takes it' }));
    expect(onSubmit).toHaveBeenCalledWith(
      { productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }], form: 'tablet', dosesPerDay: 3, instruction: '', warnings: [] },
      'confirm',
    );
    expect(markers()).toHaveLength(0);
  });

  it('shows linked errors, focuses the first one, and does not submit', async () => {
    const onSubmit = vi.fn();
    render(<LineConfirmForm line={{ ...dolo, productName: '' }} fromExtraction={false} actions={actions} onSubmit={onSubmit} />);
    expect(markers()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('How many per day'), 'three');
    await userEvent.click(screen.getByRole('button', { name: 'Save as found at home' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Product name')).toHaveFocus();
    expect(screen.getByLabelText('Product name')).toHaveAccessibleDescription(/Please enter the name printed on the pack\./);
    expect(screen.getByLabelText('How many per day')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('lineDraft', () => {
  it('never guesses numbers', () => {
    const draft = draftFromLine(dolo);
    draft.ingredients[0].strength = '650mg';
    expect(validateDraft(draft).line).toBeNull();
  });

  it('routes unmatched warnings to the general list', () => {
    const draft = draftFromLine(dolo);
    expect(warningsByField(['Photo is blurry'], draft)).toEqual({ general: ['Photo is blurry'] });
  });
});
