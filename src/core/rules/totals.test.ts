import { describe, expect, it } from 'vitest';
import { ing, med } from './testkit';
import { duplicateGroups, ingredientTotals } from './totals';

describe('ingredientTotals', () => {
  it('reports only ingredients found in two or more active medicines', () => {
    const totals = ingredientTotals([
      med({ ingredients: [ing('paracetamol', 650)], dosesPerDay: 3 }),
      med({ ingredients: [ing('metformin', 500)], dosesPerDay: 2 }),
    ]);
    expect(totals).toEqual([]);
  });

  it('detects the same ingredient under different brand names', () => {
    const dolo = med({ productName: 'Dolo 650', ingredients: [ing('Paracetamol IP', 650)], dosesPerDay: 3 });
    const crocin = med({ productName: 'Crocin Advance 500', ingredients: [ing('acetaminophen', 500)], dosesPerDay: 3 });
    expect(ingredientTotals([dolo, crocin])).toEqual([
      {
        ingredient: 'paracetamol',
        unit: 'mg',
        perDay: 3450,
        parts: [
          { medicineId: dolo.id, productName: 'Dolo 650', perDay: 1950 },
          { medicineId: crocin.id, productName: 'Crocin Advance 500', perDay: 1500 },
        ],
        complete: true,
      },
    ]);
  });

  it('0.5 g + 250 mg = 750 mg', () => {
    const [total] = ingredientTotals([
      med({ ingredients: [ing('paracetamol', 0.5, 'g')], dosesPerDay: 1 }),
      med({ ingredients: [ing('paracetamol', 250, 'mg')], dosesPerDay: 1 }),
    ]);
    expect(total).toMatchObject({ unit: 'mg', perDay: 750, complete: true });
    expect(total.parts.map((p) => p.perDay)).toEqual([500, 250]);
  });

  it('500 mcg + 1 mg = 1.5 mg', () => {
    const [total] = ingredientTotals([
      med({ ingredients: [ing('folic acid', 500, 'mcg')], dosesPerDay: 1 }),
      med({ ingredients: [ing('folic acid', 1, 'mg')], dosesPerDay: 1 }),
    ]);
    expect(total).toMatchObject({ unit: 'mg', perDay: 1.5 });
    expect(total.parts.map((p) => p.perDay)).toEqual([0.5, 1]);
  });

  it('keeps the unit when every part uses the same one', () => {
    const grams = ingredientTotals([
      med({ ingredients: [ing('metformin', 1, 'g')], dosesPerDay: 1 }),
      med({ ingredients: [ing('metformin', 0.5, 'g')], dosesPerDay: 2 }),
    ]);
    expect(grams[0]).toMatchObject({ unit: 'g', perDay: 2 });
    const micrograms = ingredientTotals([
      med({ ingredients: [ing('levothyroxine', 25, 'mcg')], dosesPerDay: 1 }),
      med({ ingredients: [ing('levothyroxine', 50, 'mcg')], dosesPerDay: 1 }),
    ]);
    expect(micrograms[0]).toMatchObject({ unit: 'mcg', perDay: 75 });
  });

  it('falls back to micrograms when milligrams would lose precision', () => {
    const [total] = ingredientTotals([
      med({ ingredients: [ing('calcitriol', 0.25, 'mcg')], dosesPerDay: 1 }),
      med({ ingredients: [ing('calcitriol', 0.001, 'mg')], dosesPerDay: 1 }),
    ]);
    expect(total).toMatchObject({ unit: 'mcg', perDay: 1.25 });
    const unknownDoses = ingredientTotals([
      med({ ingredients: [ing('calcitriol', 0.25, 'mcg')], dosesPerDay: null }),
      med({ ingredients: [ing('calcitriol', 0.001, 'mg')], dosesPerDay: 1 }),
    ]);
    expect(unknownDoses[0].unit).toBe('mcg');
  });

  it('never adds mass to volume or to international units: each gets its own total', () => {
    const tablet = med({ ingredients: [ing('paracetamol', 500, 'mg')], dosesPerDay: 2 });
    const syrup = med({ ingredients: [ing('paracetamol', 5, 'ml')], form: 'syrup', dosesPerDay: 3 });
    const totals = ingredientTotals([tablet, syrup]);
    expect(totals).toEqual([
      { ingredient: 'paracetamol', unit: 'mg', perDay: 1000, parts: [{ medicineId: tablet.id, productName: tablet.productName, perDay: 1000 }], complete: true },
      { ingredient: 'paracetamol', unit: 'ml', perDay: 15, parts: [{ medicineId: syrup.id, productName: syrup.productName, perDay: 15 }], complete: true },
    ]);

    const drops = med({ ingredients: [ing('cholecalciferol', 400, 'IU')], dosesPerDay: 1 });
    const sachet = med({ ingredients: [ing('Vitamin D3', 1.5, 'mg')], dosesPerDay: 1 });
    const d3 = ingredientTotals([drops, sachet]);
    expect(d3.map((t) => [t.unit, t.perDay])).toEqual([['mg', 1.5], ['IU', 400]]);
  });

  it('gives no total when any part has no dosesPerDay', () => {
    const known = med({ ingredients: [ing('paracetamol', 650)], dosesPerDay: 3 });
    const unknown = med({ ingredients: [ing('paracetamol', 500)], dosesPerDay: null });
    const [total] = ingredientTotals([known, unknown]);
    expect(total.complete).toBe(false);
    expect(total.perDay).toBe(0);
    expect(total.parts).toEqual([
      { medicineId: known.id, productName: known.productName, perDay: 1950 },
      { medicineId: unknown.id, productName: unknown.productName, perDay: 0 },
    ]);
  });

  it('a combination product contributes to the total of each of its ingredients', () => {
    const combo = med({ productName: 'Combiflam', ingredients: [ing('ibuprofen', 400), ing('paracetamol', 325)], dosesPerDay: 3 });
    const dolo = med({ productName: 'Dolo 650', ingredients: [ing('paracetamol', 650)], dosesPerDay: 2 });
    const brufen = med({ productName: 'Brufen 400', ingredients: [ing('ibuprofen', 400)], dosesPerDay: 1 });
    const totals = ingredientTotals([combo, dolo, brufen]);
    expect(totals.map((t) => [t.ingredient, t.perDay])).toEqual([
      ['ibuprofen', 1600],
      ['paracetamol', 2275],
    ]);
    expect(totals[1].parts.map((p) => p.medicineId)).toEqual([combo.id, dolo.id]);
  });

  it('ignores stopped medicines', () => {
    const totals = ingredientTotals([
      med({ ingredients: [ing('paracetamol', 650)], dosesPerDay: 3 }),
      med({ ingredients: [ing('paracetamol', 500)], dosesPerDay: 3, status: 'stopped' }),
    ]);
    expect(totals).toEqual([]);
  });

  it('counts a medicine once even if it lists the ingredient twice', () => {
    const odd = med({ ingredients: [ing('paracetamol', 300), ing('Paracetamol IP', 200)], dosesPerDay: 2 });
    expect(ingredientTotals([odd])).toEqual([]);
    const [total] = ingredientTotals([odd, med({ ingredients: [ing('paracetamol', 500)], dosesPerDay: 1 })]);
    expect(total.perDay).toBe(1500);
    expect(total.parts[0].perDay).toBe(1000);
  });

  it('rounds to at most three decimals', () => {
    const [total] = ingredientTotals([
      med({ ingredients: [ing('digoxin', 0.1, 'mg')], dosesPerDay: 3 }),
      med({ ingredients: [ing('digoxin', 0.0625, 'mg')], dosesPerDay: 1 }),
    ]);
    expect(0.1 * 3).not.toBe(0.3);
    expect(total.parts.map((p) => p.perDay)).toEqual([0.3, 0.063]);
    expect(total.perDay).toBe(0.363);
    const thirds = ingredientTotals([
      med({ ingredients: [ing('prednisolone', 5)], dosesPerDay: 1 / 3 }),
      med({ ingredients: [ing('prednisolone', 5)], dosesPerDay: 1 / 3 }),
    ]);
    expect(thirds[0].perDay).toBe(3.333);
  });

  it('lists groups by ingredient name and medicines oldest first', () => {
    const newer = med({ id: 'b', ingredients: [ing('paracetamol', 500)], createdAt: '2026-02-02T10:00:00+05:30' });
    const older = med({ id: 'a', ingredients: [ing('paracetamol', 650)], createdAt: '2026-02-01T10:00:00+05:30' });
    const twinA = med({ id: 'y', ingredients: [ing('ibuprofen', 400)], createdAt: '2026-02-03T10:00:00+05:30' });
    const twinB = med({ id: 'x', ingredients: [ing('ibuprofen', 200)], createdAt: '2026-02-03T10:00:00+05:30' });
    const groups = duplicateGroups([newer, twinA, older, twinB]);
    expect(groups.map((g) => [g.ingredient, g.medicines.map((m) => m.id)])).toEqual([
      ['ibuprofen', ['x', 'y']],
      ['paracetamol', ['a', 'b']],
    ]);
  });
});
