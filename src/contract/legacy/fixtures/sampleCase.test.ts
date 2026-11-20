import { describe, expect, it } from 'vitest';
import { expected, SAMPLE_TODAY } from './sampleCase';

describe('sample case fixtures', () => {
  it('paracetamol total is 1950 + 1500 mg per day', () => {
    const paracetamol = expected.ingredientTotals.find((t) => t.ingredient === 'paracetamol');
    expect(paracetamol).toBeDefined();
    expect(1950 + 1500).toBe(paracetamol!.perDay);
    expect(paracetamol!.unit).toBe('mg');
    expect(SAMPLE_TODAY).toBe('2026-11-14');
  });
});
