import { describe, expect, it } from 'vitest';
import { samplePrescribers } from '../../../contract/fixtures/sampleCase';
import type { ExtractedLine, FieldEvidence } from '../../../contract/types';
import { carryDecisions, fieldTitle, groupFields, isPack, linesWithChecks, matchPrescriber, needsCheck, parseCorrection } from './checkText';

function ev(field: FieldEvidence['field'], status: FieldEvidence['status'], value: string | null, extra: Partial<FieldEvidence> = {}): FieldEvidence {
  return {
    id: `${field}-${extra.lineIndex ?? 0}-${status}`, profileId: 'p', documentId: 'd', field, lineIndex: 0, ingredientIndex: field === 'strength' || field === 'unit' || field === 'ingredient' ? 0 : null,
    page: 1, raw: value, value, status, reasons: [], source: 'ocr', confidence: null, region: null, reviewedAt: null, ...extra,
  };
}

const aspirin: ExtractedLine = {
  lineIndex: 0, productName: 'Aspirin 7? mg', ingredients: [{ name: 'aspirin', strength: 0, unit: 'mg' }], form: 'tablet',
  dosesPerDay: 1, instruction: '1 tablet, afternoon', warnings: ['Strength could not be read: "7? mg"'],
};

describe('check helpers', () => {
  it('titles a field by its state', () => {
    expect(fieldTitle({ field: 'strength', status: 'needs_verification' })).toBe('Strength not clear');
    expect(fieldTitle({ field: 'document_date', status: 'extracted' })).toBe('Date on the document read automatically');
  });

  it('parses corrections per field', () => {
    expect(parseCorrection('strength', ' 7,5 ', '2026-11-14')).toEqual({ value: '7.5' });
    expect(parseCorrection('strength', 'abc', '2026-11-14')).toHaveProperty('error');
    expect(parseCorrection('frequency', '0', '2026-11-14')).toHaveProperty('error');
    expect(parseCorrection('document_date', '2026-12-01', '2026-11-14')).toEqual({ error: 'The date on the document cannot be in the future.' });
    expect(parseCorrection('ingredient', 'Aspirin', '2026-11-14')).toEqual({ value: 'aspirin' });
    expect(parseCorrection('unit', 'kg', '2026-11-14')).toHaveProperty('error');
  });

  it('applies corrections to the lines, including the strength inside the name', () => {
    const corrected = ev('strength', 'user_corrected', '75', { raw: '7? mg' });
    const [line] = linesWithChecks([aspirin], [corrected, ev('frequency', 'user_corrected', '2')]);
    expect(line).toMatchObject({ productName: 'Aspirin 75 mg', ingredients: [{ name: 'aspirin', strength: 75, unit: 'mg' }], dosesPerDay: 2, warnings: [] });
    // Unknown leaves the line as read.
    expect(linesWithChecks([aspirin], [ev('strength', 'unknown', null, { raw: '7? mg' })])[0].productName).toBe('Aspirin 7? mg');
  });

  it('carries decisions to a retaken photo', () => {
    const earlier = [
      ev('strength', 'user_corrected', '500'),
      ev('unit', 'user_confirmed', 'mg'),
      ev('ingredient', 'user_confirmed', 'paracetamol'),
      ev('medicine_name', 'unknown', null),
    ];
    const fresh = [
      ev('strength', 'needs_verification', '650', { id: 'n1' }),
      ev('unit', 'needs_verification', 'mg', { id: 'n2' }),
      ev('ingredient', 'extracted', 'paracetamal', { id: 'n3' }),
      ev('medicine_name', 'extracted', 'Dolo 650', { id: 'n4' }),
      ev('instruction', 'extracted', '1 tablet', { id: 'n5' }),
    ];
    expect(carryDecisions(earlier, fresh)).toEqual([
      { evidenceId: 'n1', action: 'correct', value: '500' },
      { evidenceId: 'n2', action: 'confirm' },
      { evidenceId: 'n4', action: 'leave_unknown' },
    ]);
  });

  it('groups document fields first, and knows a pack and a flagged record', () => {
    const fields = [ev('strength', 'needs_verification', null, { lineIndex: 1 }), ev('document_date', 'extracted', '2026-11-13', { lineIndex: null })];
    expect(groupFields(fields).map((g) => g.lineIndex)).toEqual([null, 1]);
    expect(needsCheck(fields)).toBe(true);
    expect(needsCheck([ev('unit', 'extracted', 'mg')])).toBe(false);
    expect(isPack('other', [aspirin])).toBe(true);
    expect(isPack('prescription', [aspirin])).toBe(false);
  });

  it('matches a doctor read on a document by surname', () => {
    expect(matchPrescriber('Dr. K. Rao', samplePrescribers)?.name).toBe('Dr. Kavita Rao');
    expect(matchPrescriber('Dr. Iqbal', samplePrescribers)).toBeNull();
    expect(matchPrescriber(null, samplePrescribers)).toBeNull();
  });
});
