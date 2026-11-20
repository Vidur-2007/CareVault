// Checks that the v2 sample case is internally consistent, so both laptops can trust it.
// Behaviour (proposals, passport, search) is tested by each side against `expected`.
import { describe, expect, it } from 'vitest';
import { todayFor } from '../today';
import {
  expected,
  IDS,
  SAMPLE_DOCUMENT_FILES,
  SAMPLE_PROFILE_IDS,
  SAMPLE_TODAY,
  sampleCase,
  sampleDocuments,
  sampleHealthEntries,
  samplePrescribers,
  samplePrescriptionLines,
  sampleProfiles,
  sampleRoutine,
  sampleRoutineEvents,
  sampleVisit,
} from './sampleCase';

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('sample case v2: structure', () => {
  it('has unique ids in every table', () => {
    for (const rows of [sampleProfiles, samplePrescribers, sampleDocuments, samplePrescriptionLines, sampleRoutine, sampleRoutineEvents, sampleHealthEntries]) {
      expect(new Set(ids(rows)).size).toBe(rows.length);
    }
  });

  it('every row belongs to a sample profile, and references stay within that profile', () => {
    const profileOf = new Map<string, string>();
    for (const p of samplePrescribers) profileOf.set(p.id, p.profileId);
    for (const d of sampleDocuments) profileOf.set(d.id, d.profileId);
    for (const m of sampleRoutine) profileOf.set(m.id, m.profileId);
    const sample = new Set<string>(SAMPLE_PROFILE_IDS);
    for (const d of sampleDocuments) {
      expect(sample.has(d.profileId)).toBe(true);
      if (d.prescriberId) expect(profileOf.get(d.prescriberId)).toBe(d.profileId);
    }
    for (const m of sampleRoutine) {
      expect(sample.has(m.profileId)).toBe(true);
      if (m.prescriberId) expect(profileOf.get(m.prescriberId)).toBe(m.profileId);
      if (m.sourceDocumentId) expect(profileOf.get(m.sourceDocumentId)).toBe(m.profileId);
      if (m.replacedByMedicineId) expect(profileOf.get(m.replacedByMedicineId)).toBe(m.profileId);
    }
    for (const e of sampleRoutineEvents) {
      expect(profileOf.get(e.medicineId)).toBe(e.profileId);
      if (e.documentId) expect(profileOf.get(e.documentId)).toBe(e.profileId);
      if (e.after) expect(e.after.id).toBe(e.medicineId);
      if (e.before) expect(e.before.id).toBe(e.medicineId);
    }
    for (const h of sampleHealthEntries) expect(sample.has(h.profileId)).toBe(true);
    for (const line of samplePrescriptionLines) {
      expect(sampleDocuments.find((d) => d.id === line.documentId)?.kind).toBe('prescription');
      expect(line.verified).toBe(true);
    }
    expect(profileOf.get(sampleVisit.prescriberId)).toBe(sampleVisit.profileId);
    for (const id of sampleVisit.sharedDocumentIds) expect(profileOf.get(id)).toBe(sampleVisit.profileId);
  });

  it('every sample document has a file name, and the email report has no clinical date', () => {
    for (const d of sampleDocuments) expect(SAMPLE_DOCUMENT_FILES[d.id]).toMatch(/\.pdf$/);
    const hba1c = sampleDocuments.find((d) => d.id === IDS.documents.hba1c)!;
    expect(hba1c).toMatchObject({ clinicalDate: null, dateSource: 'unknown', source: 'email', state: 'pending_review' });
    expect(hba1c.receivedAt).not.toBeNull();
  });

  it('states the routine explicitly: no entry is current only because a prescription said so', () => {
    for (const m of sampleRoutine) {
      expect(m.source).not.toBe('from_prescription');
      expect(m.source).not.toBe('legacy');
      expect(m.legacyReviewPending).toBe(false);
      if (m.status === 'taking') expect(m.lastConfirmedAt).not.toBeNull();
    }
  });

  it('records a history event for every routine entry, oldest first per profile', () => {
    for (const m of sampleRoutine) expect(sampleRoutineEvents.some((e) => e.medicineId === m.id)).toBe(true);
    const ramesh = sampleRoutineEvents.filter((e) => e.profileId === IDS.ramesh).map((e) => Date.parse(e.at));
    expect(ramesh).toEqual([...ramesh].sort((a, b) => a - b));
  });

  it('Lakshmi has an explicit "No known allergies" entry and nothing of Ramesh', () => {
    const lakshmi = sampleHealthEntries.filter((h) => h.profileId === IDS.lakshmi);
    expect(lakshmi).toEqual([expect.objectContaining({ kind: 'allergy', noneKnown: true, text: '' })]);
    expect(sampleCase.visits.filter((v) => v.profileId === IDS.lakshmi)).toEqual([]);
  });
});

describe('sample case v2: expected values agree with the rows', () => {
  it('statuses', () => {
    for (const [id, status] of Object.entries(expected.ramesh.routineStatusById)) {
      expect(sampleRoutine.find((m) => m.id === id)?.status).toBe(status);
    }
  });

  it('the passport lists exactly the "taking" entries as current, and "uncertain" as unconfirmed', () => {
    const names = (profileId: string, status: string) =>
      sampleRoutine.filter((m) => m.profileId === profileId && m.status === status).map((m) => m.productName).sort();
    expect([...expected.ramesh.passport.currentMedicineNames].sort()).toEqual(names(IDS.ramesh, 'taking'));
    expect([...expected.ramesh.passport.unconfirmedNames].sort()).toEqual(names(IDS.ramesh, 'uncertain'));
    expect([...expected.lakshmi.passport.currentMedicineNames]).toEqual(names(IDS.lakshmi, 'taking'));
  });

  it('paracetamol: 650 mg x 3 + 500 mg x 3 = 3450 mg a day', () => {
    const [total] = expected.ramesh.ingredientTotals;
    for (const part of total.parts) {
      const m = sampleRoutine.find((r) => r.id === part.medicineId)!;
      expect(m.ingredients[0].strength * m.dosesPerDay!).toBe(part.perDay);
    }
    expect(total.parts.reduce((sum, p) => sum + p.perDay, 0)).toBe(total.perDay);
    expect(total.perDay).toBe(3450);
  });

  it('documents newest first, undated last, per profile', () => {
    const order = (profileId: string) => {
      const docs = sampleDocuments.filter((d) => d.profileId === profileId);
      const dated = docs.filter((d) => d.clinicalDate).sort((a, b) => b.clinicalDate!.localeCompare(a.clinicalDate!));
      return [...dated, ...docs.filter((d) => !d.clinicalDate)].map((d) => d.id);
    };
    expect(order(IDS.ramesh)).toEqual([...expected.ramesh.documentIdsNewestFirst]);
    expect(order(IDS.lakshmi)).toEqual([...expected.lakshmi.documentIdsNewestFirst]);
  });

  it('the demo prescription: rows refer to real entries; passive rows are the other prescribers', () => {
    const demo = expected.demoPrescription;
    const rao = demo.prescriberId;
    for (const row of demo.proposalRows) {
      if (row.medicineId) expect(sampleRoutine.find((m) => m.id === row.medicineId)?.profileId).toBe(IDS.ramesh);
      if (row.kind === 'not_mentioned') expect(sampleRoutine.find((m) => m.id === row.medicineId)?.prescriberId).toBe(rao);
    }
    for (const id of demo.passiveMedicineIds) expect(sampleRoutine.find((m) => m.id === id)?.prescriberId).not.toBe(rao);
    expect(demo.passiveMedicineIds).toHaveLength(demo.passiveNotMentionedCount);
    expect(demo.verifiedLines.map((l) => l.productName)).toEqual(['Amlodipine 10 mg', 'Telmisartan 80 mg', 'Rosuvastatin 10 mg', 'Aspirin 75 mg']);
    expect(demo.clinicalDate < SAMPLE_TODAY).toBe(true);
  });

  it('the demo prescription: Aspirin reads as printed and is blocked until checked, then reads 75 mg', () => {
    const demo = expected.demoPrescription;
    const aspirin = (rows: readonly { kind: string; lineProductName: string | null; blockedByVerification: boolean }[]) => rows.find((r) => r.kind === 'new')!;
    expect(aspirin(demo.proposalRows)).toMatchObject({ lineProductName: `Aspirin ${demo.aspirinStrengthAsRead}`, blockedByVerification: true });
    expect(aspirin(demo.proposalRowsAfterCheck)).toMatchObject({ lineProductName: 'Aspirin 75 mg', blockedByVerification: false });
    // Nothing else differs between the two states, and nothing else is ever blocked.
    const others = (rows: readonly { kind: string }[]) => rows.filter((r) => r.kind !== 'new');
    expect(others(demo.proposalRowsAfterCheck)).toEqual(others(demo.proposalRows));
    expect(demo.proposalRows.filter((r) => r.blockedByVerification)).toHaveLength(1);
    expect(demo.proposalRowsAfterCheck.some((r) => r.blockedByVerification)).toBe(false);
    // The decision on Aspirin is made on the checked line.
    expect(demo.decisions.some((d) => 'lineProductName' in d && d.lineProductName === 'Aspirin 75 mg')).toBe(true);
  });
});

describe('todayFor', () => {
  it('pins the sample profiles to SAMPLE_TODAY and leaves others on the device date', () => {
    expect(todayFor(IDS.ramesh, '2027-01-15')).toBe(SAMPLE_TODAY);
    expect(todayFor(IDS.lakshmi, '2027-01-15')).toBe(SAMPLE_TODAY);
    expect(todayFor('another-profile', '2027-01-15')).toBe('2027-01-15');
    expect(todayFor(null, '2027-01-15')).toBe('2027-01-15');
  });
});
