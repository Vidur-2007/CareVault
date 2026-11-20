import { describe, expect, it, vi } from 'vitest';
import { expected, IDS } from '../../contract/legacy/fixtures/sampleCase';
import type { MedicineStatus } from '../../contract/legacy/types';
import { ServiceError } from '../../contract/legacy/types';
import { createMockServices } from './createMockServices';

const P = IDS.profile;
const make = (fail: string | null = null) => createMockServices({ delayMs: 0, fail: () => fail });

describe('mock services: sample case', () => {
  it('returns the sample profile and prescribers', async () => {
    const s = make();
    const profiles = await s.profiles.list();
    expect(profiles.map((p) => p.name)).toEqual(['Ramesh Iyer']);
    expect((await s.profiles.prescribers(P)).map((p) => p.name)).toEqual(['Dr. Kavita Rao', 'Dr. Suresh Menon']);
  });

  it('medicine status counts match the expected counts', async () => {
    const s = make();
    const meds = await s.medicines.list(P);
    const counts: Record<MedicineStatus, number> = { confirmed_current: 0, needs_confirmation: 0, found_at_home: 0, stopped: 0 };
    for (const m of meds) counts[m.status] += 1;
    expect(counts).toEqual(expected.statusCounts);
  });

  it('has the three expected open review items', async () => {
    const s = make();
    const open = await s.review.listOpen(P);
    expect(open.map((r) => r.id).sort()).toEqual([...expected.openReviewItemIds].sort());
  });

  it('ingredient totals equal the expected paracetamol total of 3450 mg', async () => {
    const s = make();
    const totals = await s.medicines.ingredientTotals(P);
    expect(totals).toEqual(expected.ingredientTotals);
    expect(totals[0].perDay).toBe(3450);
  });

  it('latest diff for Dr. Rao matches the expected rows', async () => {
    const s = make();
    const diff = await s.prescriptions.latestDiff(P, IDS.prescribers.rao);
    expect(diff?.previousDocumentId).toBe(expected.diff.previousDocumentId);
    expect(diff?.latestDocumentId).toBe(expected.diff.latestDocumentId);
    expect(diff?.rows.map((r) => [r.kind, r.previous?.id ?? null, r.latest?.id ?? null, r.reviewItemId])).toEqual(
      expected.diffRows.map((r) => [r.kind, r.previous?.id ?? null, r.latest?.id ?? null, r.reviewItemId]),
    );
  });

  it('change summary matches the expected summary', async () => {
    const s = make();
    expect(await s.visits.changeSummary(P)).toEqual(expected.changeSummary);
  });

  it('next visit is Dr. Rao on 18 November with two questions', async () => {
    const s = make();
    const visit = await s.visits.next(P);
    expect(visit?.prescriberId).toBe(IDS.prescribers.rao);
    expect(visit?.questions).toHaveLength(2);
  });

  it('builds a passport with four current medicines and one flag', async () => {
    const s = make();
    const passport = await s.visits.buildPassport(P);
    expect(passport.patientAge).toBe(71);
    expect(passport.currentMedicines.map((m) => m.productName)).toEqual([
      'Amlodipine 10 mg', 'Rosuvastatin 10 mg', 'Telmisartan 40 mg', 'Metformin 500 mg',
    ]);
    expect(passport.changes.map((c) => c.kind)).toEqual(['added', 'changed', 'unconfirmed']);
    expect(passport.flags).toHaveLength(1);
    expect(passport.documents.map((d) => d.title)).toEqual(['Lipid profile', 'ECG report']);
  });
});

describe('mock services: behaviour', () => {
  it('resolving "still taking" confirms Atorvastatin and closes the item', async () => {
    const s = make();
    await s.review.resolve(IDS.reviewItems.confirmAtorvastatin, 'still_taking');
    expect((await s.medicines.get(IDS.medicines.atorvastatin10)).status).toBe('confirmed_current');
    expect(await s.review.listOpen(P)).toHaveLength(2);
  });

  it('resolving "ask the doctor" keeps the status and adds a question', async () => {
    const s = make();
    await s.review.resolve(IDS.reviewItems.confirmAtorvastatin, 'ask_doctor');
    expect((await s.medicines.get(IDS.medicines.atorvastatin10)).status).toBe('needs_confirmation');
    expect((await s.visits.next(P))?.questions).toHaveLength(3);
  });

  it('applying the same prescription twice changes nothing the second time', async () => {
    const s = make();
    const before = await s.medicines.list(P);
    await s.prescriptions.apply(P, IDS.documents.raoLatest, IDS.prescribers.rao, []);
    expect(await s.medicines.list(P)).toEqual(before);
  });

  it('subscribe fires after a write and not after unsubscribing', async () => {
    const s = make();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    await s.documents.star(IDS.documents.ecg, true);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await s.documents.star(IDS.documents.ecg, false);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the failure switch makes reading.read reject', async () => {
    const s = make('reading');
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    await expect(s.reading.read(photo, { allowCloud: false })).rejects.toBeInstanceOf(ServiceError);
    await expect(s.medicines.list(P)).resolves.toHaveLength(9);
  });

  it('cloud_consent switch asks for consent only when cloud is not allowed', async () => {
    const s = make('cloud_consent');
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    await expect(s.reading.read(photo, { allowCloud: false })).rejects.toMatchObject({ code: 'cloud_consent_required' });
    await expect(s.reading.read(photo, { allowCloud: true })).resolves.toMatchObject({ engine: 'cloud' });
  });

  it('unknown ids reject with not_found', async () => {
    const s = make();
    await expect(s.medicines.get('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('starts empty when not seeded, and loadSampleProfile is idempotent', async () => {
    const s = createMockServices({ delayMs: 0, seeded: false, fail: () => null });
    expect(await s.profiles.list()).toHaveLength(0);
    await s.profiles.loadSampleProfile();
    await s.profiles.loadSampleProfile();
    expect(await s.profiles.list()).toHaveLength(1);
    expect(await s.medicines.list(P)).toHaveLength(9);
  });
});
