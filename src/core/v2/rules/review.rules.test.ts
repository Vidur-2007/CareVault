// The pure review rules, for the paths the service tests do not reach.
import { describe, expect, it } from 'vitest';
import { IDS, sampleProfiles, sampleRoutine, sampleVisit } from '../../../contract/fixtures/sampleCase';
import type { PrescriptionLine, RoutineEvent, RoutineMedicine } from '../../../contract/types';
import { planDecisions, rebuildWith } from './decide';
import { buildProposal, matchLine, type ProposalInput } from './proposal';
import { planHealthAdd, planUndo, reconcileSavedLines, routineEvent, sameValue } from './routine';
import type { ExtractedLine, FieldEvidence } from '../../../contract/types';

const M = IDS.medicines;
const NOW = '2026-11-14T09:00:00.000Z';
let ids = 0;
const ctx = { now: NOW, newId: () => `rule-id-${(ids += 1)}` };

const ramesh = sampleRoutine.filter((m) => m.profileId === IDS.ramesh);
const entry = (id: string) => ramesh.find((m) => m.id === id)!;

function line(lineIndex: number, productName: string, name: string | null, strength = 75): PrescriptionLine {
  return {
    id: `line-${lineIndex}`, documentId: 'doc', lineIndex, productName, form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, afternoon', verified: true,
    ingredients: name ? [{ name, strength, unit: 'mg' }] : [],
  };
}

const input = (lines: PrescriptionLine[], routine: RoutineMedicine[] = ramesh): ProposalInput => ({
  proposalId: 'p', profileId: IDS.ramesh, documentId: 'doc', prescriberId: IDS.prescribers.rao, lines, routine, routineRevision: 1, now: NOW, previous: null,
});

describe('matching', () => {
  it('a remembered match whose entry is gone is matched afresh', () => {
    expect(matchLine(line(0, 'Aspirin 75 mg', 'aspirin'), ramesh, null, 'deleted-entry').kind).toBe('new');
  });

  it('names shorter than three letters never match by name', () => {
    expect(matchLine(line(0, 'Do', null), [{ ...entry(M.dolo650), productName: 'Do 650' }], null, undefined)).toMatchObject({ kind: 'uncertain_match', medicine: null });
  });

  it('two entries with the same name are ordered by id', () => {
    const twins = [{ ...entry(M.dolo650), id: 'b' }, { ...entry(M.dolo650), id: 'a' }];
    expect(matchLine(line(0, 'Dolo', null), twins, null, undefined).medicine!.id).toBe('a');
  });
});

describe('recomputing a proposal', () => {
  it('a skip is dropped when the row is no longer the same kind', () => {
    const first = buildProposal(input([line(0, 'Aspirin 75 mg', 'aspirin')]));
    const skipped = { ...first, rows: first.rows.map((r) => (r.kind === 'new' ? { ...r, decision: 'skip' as const, decidedAt: NOW } : r)) };
    const aspirin: RoutineMedicine = { ...entry(M.amlodipine10), id: 'aspirin', productName: 'Aspirin 75 mg', ingredients: [{ name: 'aspirin', strength: 75, unit: 'mg' }], instruction: '1 tablet, afternoon' };
    const again = buildProposal({ ...input([line(0, 'Aspirin 75 mg', 'aspirin')], [...ramesh, aspirin]), previous: skipped });
    expect(again.rows.find((r) => r.line)).toMatchObject({ kind: 'same', decision: null });
  });

  it('keeps a dismissed status until the user reopens it', () => {
    const first = buildProposal(input([line(0, 'Aspirin 75 mg', 'aspirin')]));
    expect(buildProposal({ ...input(first.rows.map((r) => r.line!).filter(Boolean)), previous: { ...first, status: 'dismissed' } }).status).toBe('dismissed');
  });
});

describe('decisions', () => {
  it('a question already on the visit is not added twice', () => {
    const base = input([line(0, 'Aspirin 75 mg', 'aspirin')]);
    const proposal = buildProposal(base);
    const row = proposal.rows.find((r) => r.kind === 'new')!;
    const visit = { ...sampleVisit, questions: [...sampleVisit.questions, { id: 'q', text: 'Should Aspirin 75 mg be started?', source: 'manual' as const, medicineId: null, documentId: null }] };
    const result = planDecisions(
      { proposal, decisions: [{ rowId: row.id, choice: 'ask_doctor' }], expectedRevision: 1, currentRevision: 1, entries: new Map(ramesh.map((m) => [m.id, m])), nextVisit: visit, rebuild: rebuildWith(base) },
      ctx,
    );
    expect(result).toMatchObject({ questionsAdded: [], visit: null });
  });

  it('works on an entry the caller did not load', () => {
    const base = input([line(0, 'Telmisartan 80 mg', 'telmisartan', 80)]);
    const proposal = buildProposal(base);
    const row = proposal.rows.find((r) => r.kind === 'changed')!;
    const result = planDecisions(
      { proposal, decisions: [{ rowId: row.id, choice: 'kept_previous' }], expectedRevision: 1, currentRevision: 1, entries: new Map(), nextVisit: null, rebuild: rebuildWith(base) },
      ctx,
    );
    expect(result.changed.map((m) => m.id)).toEqual([M.telmisartan40]);
  });
});

describe('undo and health rules', () => {
  const stop = (): RoutineEvent => routineEvent('stopped', entry(M.dolo650), { ...entry(M.dolo650), status: 'stopped' }, 'Stopped', ctx);

  it('an undo or a migration cannot itself be undone', () => {
    const undone = { ...stop(), type: 'undone' as const };
    const migrated = { ...stop(), type: 'migrated' as const };
    for (const event of [undone, migrated]) expect(() => planUndo(event, [event], new Map(), ctx)).toThrow('cannot be undone');
  });

  it('restores an entry that is no longer stored', () => {
    const event = stop();
    const plan = planUndo(event, [event], new Map(), ctx);
    expect(plan.upserts[0]).toMatchObject({ id: M.dolo650, status: 'taking' });
    expect(plan.events[0]).toMatchObject({ type: 'undone', before: null, undoesEventId: event.id });
  });

  it('undoing an addition whose entry is already gone deletes nothing', () => {
    const added = routineEvent('added', null, entry(M.dolo650), 'Added', ctx);
    const plan = planUndo(added, [added], new Map(), ctx);
    expect(plan).toMatchObject({ upserts: [], deleteIds: [] });
    expect(plan.events).toHaveLength(1);
  });

  it('"No known allergies" on a profile with no allergy recorded', () => {
    const profile = sampleProfiles.find((p) => p.id === IDS.ramesh)!;
    const { add, removeIds } = planHealthAdd([], profile, { kind: 'allergy', text: 'ignored', noneKnown: true, source: 'caregiver_reported', documentId: null }, ctx);
    expect(add).toMatchObject({ kind: 'allergy', noneKnown: true, text: '', profileId: IDS.ramesh });
    expect(removeIds).toEqual([]);
  });
});

describe('saving lines against their evidence (UI request v2-1)', () => {
  const line: ExtractedLine = { lineIndex: 0, productName: 'Aspirin 75 mg', ingredients: [{ name: 'Aspirin', strength: 75, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, afternoon', warnings: [] };
  const ev = (over: Partial<FieldEvidence>): FieldEvidence => ({
    id: over.id ?? `${over.field}-${over.ingredientIndex ?? 'x'}`, profileId: 'p', documentId: 'd', field: 'medicine_name', lineIndex: 0, ingredientIndex: null, page: 1,
    raw: null, value: null, status: 'extracted', reasons: [], source: 'ocr', confidence: null, region: null, reviewedAt: null, ...over,
  });

  it('read values the line still shows are confirmed, numbers compared as numbers', () => {
    const evidence = [
      ev({ field: 'medicine_name', value: 'Aspirin 75 mg' }),
      ev({ field: 'ingredient', ingredientIndex: 0, value: 'aspirin' }),
      ev({ field: 'strength', ingredientIndex: 0, value: '75.0' }),
      ev({ field: 'unit', ingredientIndex: 0, value: 'mg' }),
      ev({ field: 'frequency', value: '1' }),
      ev({ field: 'instruction', value: ' 1 tablet, afternoon ' }),
      // An ingredient the line no longer has, and a field no line shows: nothing to compare.
      ev({ field: 'strength', ingredientIndex: 3, value: '5' }),
      ev({ field: 'patient_name', value: 'Ramesh Iyer' }),
      // Another line, and a document-level value: left alone.
      ev({ id: 'other-line', field: 'medicine_name', lineIndex: 7, value: 'X' }),
      ev({ id: 'doc-level', field: 'document_date', lineIndex: null, value: '2026-11-13' }),
    ];
    const { lines, changed } = reconcileSavedLines([line], evidence, NOW);
    expect(changed.map((c) => [c.id, c.status])).toEqual(evidence.slice(0, 8).map((e) => [e.id, 'user_confirmed']));
    expect(lines[0]).toMatchObject({ productName: 'Aspirin 75 mg', dosesPerDay: 1 });
  });

  it('edits in the line form are corrections, including a frequency cleared or set', () => {
    const cleared = reconcileSavedLines([{ ...line, dosesPerDay: null }], [ev({ field: 'frequency', value: '1' })], NOW);
    expect(cleared.changed[0]).toMatchObject({ status: 'user_corrected', value: null });
    const set = reconcileSavedLines([line], [ev({ field: 'frequency', value: null })], NOW);
    expect(set.changed[0]).toMatchObject({ status: 'user_corrected', value: '1' });
    const both = reconcileSavedLines([{ ...line, dosesPerDay: null }], [ev({ field: 'frequency', value: null })], NOW);
    expect(both.changed[0].status).toBe('user_confirmed');
  });

  it('flagged and unknown values keep what the evidence says, whatever the line says', () => {
    const flagged = (over: Partial<FieldEvidence>) => ev({ status: 'needs_verification', ...over });
    const unknown = (over: Partial<FieldEvidence>) => ev({ status: 'unknown', ...over });
    const withValues = reconcileSavedLines([line], [
      flagged({ field: 'medicine_name', value: 'Asp1rin 7? mg' }),
      flagged({ field: 'ingredient', ingredientIndex: 0, value: 'asp1rin' }),
      unknown({ field: 'strength', ingredientIndex: 0, value: '5' }),
      flagged({ field: 'unit', ingredientIndex: 0, value: 'mcg' }),
      flagged({ field: 'frequency', value: '2' }),
      flagged({ field: 'instruction', value: '2 tablets' }),
    ], NOW);
    expect(withValues.changed).toEqual([]);
    expect(withValues.lines[0]).toMatchObject({ productName: 'Asp1rin 7? mg', ingredients: [{ name: 'asp1rin', strength: 5, unit: 'mcg' }], dosesPerDay: 2, instruction: '2 tablets' });

    const withoutValues = reconcileSavedLines([line], [
      flagged({ field: 'medicine_name', raw: 'Asp?rin' }),
      flagged({ id: 'n2', field: 'medicine_name', lineIndex: 1 }),
      flagged({ field: 'ingredient', ingredientIndex: 0 }),
      flagged({ field: 'strength', ingredientIndex: 0 }),
      flagged({ field: 'unit', ingredientIndex: 0 }),
      flagged({ field: 'frequency' }),
      unknown({ field: 'instruction' }),
    ], NOW);
    expect(withoutValues.lines[0]).toMatchObject({ productName: 'Asp?rin', ingredients: [{ name: 'Aspirin', strength: 0, unit: 'mg' }], dosesPerDay: null, instruction: '' });
    const noRaw = reconcileSavedLines([line], [flagged({ field: 'medicine_name' })], NOW);
    expect(noRaw.lines[0].productName).toBe('Aspirin 75 mg');
  });
});

describe('comparing evidence values', () => {
  it('numbers as numbers, text ignoring outer spaces, and a missing value differs from any text', () => {
    expect(sameValue('strength', '75', '75.0')).toBe(true);
    expect(sameValue('strength', '75', null)).toBe(false);
    expect(sameValue('instruction', ' night ', 'night')).toBe(true);
    expect(sameValue('instruction', null, 'night')).toBe(false);
    expect(sameValue('instruction', 'night', null)).toBe(false);
    expect(sameValue('instruction', null, null)).toBe(true);
  });
});
