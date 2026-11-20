// The live passport rule, for paths the service tests do not reach.
import { describe, expect, it } from 'vitest';
import { IDS, sampleProfiles, samplePrescribers, sampleRoutine, sampleVisit } from '../../../contract/fixtures/sampleCase';
import type { RoutineEvent, RoutineMedicine } from '../../../contract/types';
import { buildPassport, dateOf, recentChanges, type PassportInput } from './passport';

const M = IDS.medicines;
const ramesh = sampleRoutine.filter((m) => m.profileId === IDS.ramesh);
const entry = (id: string) => ramesh.find((m) => m.id === id)!;

const base: PassportInput = {
  profile: sampleProfiles.find((p) => p.id === IDS.ramesh)!,
  today: '2026-11-14',
  prescribers: samplePrescribers.filter((p) => p.profileId === IDS.ramesh),
  routine: ramesh,
  events: [],
  health: [],
  documents: [],
  visit: null,
};

function event(type: RoutineEvent['type'], after: RoutineMedicine, at = '2026-11-01T10:00:00+05:30', id = `${type}-${after.id}`): RoutineEvent {
  return { id, profileId: IDS.ramesh, medicineId: after.id, type, at, documentId: null, proposalId: null, before: null, after, undoesEventId: null, detail: '' };
}

describe('recent changes', () => {
  it('a medicine taken again', () => {
    expect(recentChanges([event('restarted', entry(M.dolo650))], ramesh, base.today)).toEqual([{ kind: 'started', text: 'Started again: Dolo 650', on: '2026-11-01' }]);
  });

  it('a replacement whose new entry is no longer stored', () => {
    const replaced = event('replaced', { ...entry(M.telmisartan40), status: 'stopped', replacedByMedicineId: 'gone' });
    expect(recentChanges([replaced], ramesh, base.today)).toEqual([{ kind: 'changed', text: 'Telmisartan 40 mg replaced', on: '2026-11-01' }]);
  });

  it('an entry added as not confirmed is not a change to what is taken', () => {
    expect(recentChanges([event('added', { ...entry(M.dolo650), status: 'uncertain' })], ramesh, base.today)).toEqual([]);
  });
});

describe('the passport', () => {
  it('a visit, a doctor or a confirmation that is not known', () => {
    const orphan: RoutineMedicine = { ...entry(M.amlodipine10), id: 'orphan', prescriberId: 'deleted-doctor', lastConfirmedAt: null };
    const twin: RoutineMedicine = { ...orphan, id: 'a-twin' };
    const passport = buildPassport({ ...base, routine: [orphan, twin], visit: { ...sampleVisit, prescriberId: 'deleted-doctor' } });
    expect(passport.visit).toEqual({ at: sampleVisit.at, prescriberName: '', specialty: '' });
    expect(passport.currentMedicines).toHaveLength(2);
    expect(passport.currentMedicines[0]).toMatchObject({ prescriberName: null, lastConfirmedOn: null });
  });
});

describe('dates', () => {
  it('keeps a stated offset, and reads device (UTC) times in the local time zone', () => {
    expect(dateOf('2026-11-14T00:30:00+05:30')).toBe('2026-11-14');
    const utc = '2026-11-13T19:00:00.000Z';
    const local = new Date(utc);
    expect(dateOf(utc)).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
  });
});
