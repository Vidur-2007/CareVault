import '../../test/configureTesting';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expected, IDS, sampleMedicines } from '../../../contract/fixtures/sampleCase';
import type { IngredientTotal, Medicine } from '../../../contract/types';
import { pronounsFor } from '../../lib/pronouns';
import { DUPLICATE_SAFETY_SENTENCE, DuplicateCard } from './DuplicateCard';

const complete = expected.ingredientTotals[0] as IngredientTotal;

describe('DuplicateCard', () => {
  it('shows the total and the sum written out when the total is complete', () => {
    render(<DuplicateCard total={complete} medicines={sampleMedicines} pronouns={pronounsFor('Father')} />);
    expect(screen.getByRole('heading', { name: 'Paracetamol appears in two products' })).toBeInTheDocument();
    expect(screen.getByText('Possible duplicate ingredient')).toBeInTheDocument();
    expect(screen.getByText('If both are taken as entered')).toBeInTheDocument();
    expect(screen.getByTestId('duplicate-total')).toHaveTextContent('3,450 mg a day');
    expect(screen.getByText('1,950 mg + 1,500 mg of paracetamol')).toBeInTheDocument();
    expect(screen.getByText('Paracetamol 650 mg per tablet')).toBeInTheDocument();
    expect(screen.getByText(DUPLICATE_SAFETY_SENTENCE)).toBeInTheDocument();
    expect(DUPLICATE_SAFETY_SENTENCE).toBe(
      'CareVault adds up what was entered. It does not judge whether a dose is safe. Please verify with a pharmacist or the prescriber.',
    );
  });

  it('shows no total when any part has no doses per day', () => {
    const medicines: Medicine[] = sampleMedicines.map((m) => (m.id === IDS.medicines.crocinAdvance500 ? { ...m, dosesPerDay: null } : m));
    const incomplete: IngredientTotal = {
      ...complete,
      perDay: 1950,
      complete: false,
      parts: [complete.parts[0], { ...complete.parts[1], perDay: 0 }],
    };
    render(<DuplicateCard total={incomplete} medicines={medicines} />);
    expect(screen.queryByTestId('duplicate-total')).toBeNull();
    expect(screen.queryByText(/3,450/)).toBeNull();
    expect(screen.getByText('Add how often each is taken to see a total')).toBeInTheDocument();
    expect(screen.getByText('Crocin Advance 500: how often not entered')).toBeInTheDocument();
    expect(screen.getByText('Dolo 650: 1,950 mg a day as entered')).toBeInTheDocument();
    expect(screen.getByText(DUPLICATE_SAFETY_SENTENCE)).toBeInTheDocument();
  });

  it('offers both actions with pronoun-aware wording', async () => {
    const onAddQuestion = vi.fn();
    const onOnlyOne = vi.fn();
    render(<DuplicateCard total={complete} medicines={sampleMedicines} pronouns={pronounsFor('Father')} onAddQuestion={onAddQuestion} onOnlyOne={onOnlyOne} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to questions for the doctor' }));
    await userEvent.click(screen.getByRole('button', { name: 'He only takes one of these' }));
    expect(onAddQuestion).toHaveBeenCalledTimes(1);
    expect(onOnlyOne).toHaveBeenCalledTimes(1);
  });
});
