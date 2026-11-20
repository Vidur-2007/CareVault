// The Phase 0 compatibility mock serves the v2 sample case without crashing.
// Laptop B extends this in UI step 1 to assert every value in fixtures `expected`.
import { describe, expect, it } from 'vitest';
import { expected, IDS } from '../../../contract/fixtures/sampleCase';
import { ServiceError } from '../../../contract/types';
import { createMockServicesV2 } from './createMockServicesV2';

describe('v2 compatibility mock (Phase 0)', () => {
  it('serves both sample profiles, and keeps them apart', async () => {
    const s = createMockServicesV2();
    expect((await s.profiles.list()).map((p) => p.id)).toEqual([IDS.ramesh, IDS.lakshmi]);
    expect((await s.documents.list(IDS.ramesh)).map((d) => d.id)).toEqual([...expected.ramesh.documentIdsNewestFirst]);
    expect((await s.documents.list(IDS.lakshmi)).map((d) => d.id)).toEqual([...expected.lakshmi.documentIdsNewestFirst]);
    expect((await s.routine.list(IDS.lakshmi)).map((m) => m.productName)).toEqual(['Levothyroxine 50 mcg']);
  });

  it('computes the paracetamol total and the live passport basics', async () => {
    const s = createMockServicesV2();
    expect(await s.routine.ingredientTotals(IDS.ramesh)).toEqual(expected.ramesh.ingredientTotals);
    const passport = await s.passport.live(IDS.ramesh);
    expect(passport.preparedOn).toBe(expected.ramesh.passport.preparedOn);
    expect(passport.patientAge).toBe(expected.ramesh.passport.patientAge);
    expect(passport.currentMedicines.map((m) => m.productName).sort()).toEqual([...expected.ramesh.passport.currentMedicineNames].sort());
    expect(passport.unconfirmed.map((m) => m.productName)).toEqual([...expected.ramesh.passport.unconfirmedNames]);
    expect(passport.allergies).toEqual(expected.ramesh.passport.allergies);
    expect((await s.passport.live(IDS.lakshmi)).allergies).toEqual(expected.lakshmi.passport.allergies);
  });

  it('binds a share to one snapshot and one profile', async () => {
    const s = createMockServicesV2();
    const snapshot = await s.passport.snapshot(IDS.ramesh, 'share');
    expect(await s.passport.snapshot(IDS.ramesh, 'print')).toMatchObject({ id: snapshot.id });
    const link = await s.sharing.create(snapshot.id, 2);
    expect(link).toMatchObject({ profileId: IDS.ramesh, snapshotId: snapshot.id });
    expect(await s.sharing.list(IDS.lakshmi)).toEqual([]);
  });

  it('marks unmodelled methods as not built yet instead of crashing', async () => {
    const s = createMockServicesV2();
    await expect(s.routine.decide('x', [], 0)).rejects.toBeInstanceOf(ServiceError);
    await expect(s.backup.export('passphrase')).rejects.toMatchObject({ code: 'unknown', message: 'not built yet' });
    expect(await s.records.ask(IDS.ramesh, 'latest lipid profile')).toMatchObject({ understood: false });
  });

  it('can start empty', async () => {
    const s = createMockServicesV2({ seeded: false });
    expect(await s.profiles.list()).toEqual([]);
    expect((await s.profiles.loadSampleProfile()).id).toBe(IDS.ramesh);
  });
});
