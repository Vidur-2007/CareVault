import { describe, expect, it } from 'vitest';
import type * as L from '../../../contract/legacy/types';
import {
  migrateDocument,
  migrateEvent,
  migrateMedicine,
  migratePrescriptionLines,
  migrateShare,
  migrateV1,
  migrateVisit,
  type V1Tables,
} from './migrate';

const NOW = '2026-11-20T10:00:00.000Z';

const med = (overrides: Partial<L.Medicine>): L.Medicine => ({
  id: 'm1', profileId: 'p1', productName: 'Amlodipine 5 mg', ingredients: [{ name: 'amlodipine', strength: 5, unit: 'mg' }],
  form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', prescriberId: 'dr', status: 'confirmed_current',
  origin: 'prescription', sourceDocumentId: 'doc', fieldState: 'confirmed', replacedByMedicineId: null,
  createdAt: '2026-08-05T12:00:00+05:30', updatedAt: '2026-08-05T12:00:00+05:30', ...overrides,
});

const ev = (type: L.MedicationEventType, at: string, documentId: string | null, medicineId = 'm1'): L.MedicationEvent => ({
  id: `${type}-${at}`, profileId: 'p1', medicineId, type, at, documentId, detail: type,
});

describe('migrateMedicine: overview section 9.9, row by row', () => {
  it('confirmed by the caregiver → taking, caregiver_reported, with the confirmation time', () => {
    const m = migrateMedicine(med({}), [ev('added', '2026-08-05T12:00:00+05:30', 'doc'), ev('confirmed', '2026-09-01T09:00:00+05:30', null), ev('confirmed', '2026-10-01T09:00:00+05:30', null)]);
    expect(m).toMatchObject({ status: 'taking', source: 'caregiver_reported', legacyReviewPending: false, lastConfirmedAt: '2026-10-01T09:00:00+05:30', legacyStatus: 'confirmed_current' });
  });

  it('typed in by hand → taking, confirmed at creation', () => {
    const m = migrateMedicine(med({ origin: 'manual' }), [ev('added', '2026-08-05T12:00:00+05:30', null)]);
    expect(m).toMatchObject({ status: 'taking', source: 'caregiver_reported', lastConfirmedAt: '2026-08-05T12:00:00+05:30' });
  });

  it('made current by the prescription rule only → uncertain, legacy, pending review', () => {
    const fromRule = migrateMedicine(med({}), [ev('added', '2026-08-05T12:00:00+05:30', 'doc')]);
    expect(fromRule).toMatchObject({ status: 'uncertain', source: 'legacy', legacyReviewPending: true, lastConfirmedAt: null });
    // A confirmation carrying a document came from a reappearing prescription, not the user.
    const reappeared = migrateMedicine(med({}), [ev('confirmed', '2026-10-28T13:00:00+05:30', 'doc2')]);
    expect(reappeared).toMatchObject({ status: 'uncertain', source: 'legacy', legacyReviewPending: true });
  });

  it('needs_confirmation → uncertain, legacy, pending', () => {
    expect(migrateMedicine(med({ status: 'needs_confirmation' }), [])).toMatchObject({ status: 'uncertain', source: 'legacy', legacyReviewPending: true, legacyStatus: 'needs_confirmation' });
  });

  it('found_at_home → uncertain, from_pack, pending', () => {
    expect(migrateMedicine(med({ status: 'found_at_home', origin: 'home_scan' }), [])).toMatchObject({ status: 'uncertain', source: 'from_pack', legacyReviewPending: true });
  });

  it('stopped by the caregiver → stopped, caregiver_reported', () => {
    const m = migrateMedicine(med({ status: 'stopped' }), [ev('marked_stopped', '2026-08-05T19:00:00+05:30', null)]);
    expect(m).toMatchObject({ status: 'stopped', source: 'caregiver_reported', legacyReviewPending: false });
  });

  it('stopped by the replacement rule → stopped, legacy, replacement kept', () => {
    const m = migrateMedicine(med({ status: 'stopped', replacedByMedicineId: 'm2' }), [ev('replaced', '2026-10-28T13:00:00+05:30', 'doc2')]);
    expect(m).toMatchObject({ status: 'stopped', source: 'legacy', replacedByMedicineId: 'm2', legacyReviewPending: false });
  });

  it('the latest stop decides: replaced after a manual stop counts as the rule', () => {
    const events = [ev('marked_stopped', '2026-08-01T10:00:00+05:30', null), ev('replaced', '2026-10-28T13:00:00+05:30', 'doc2')];
    expect(migrateMedicine(med({ status: 'stopped' }), events).source).toBe('legacy');
    expect(migrateMedicine(med({ status: 'stopped' }), [ev('marked_stopped', '2026-08-01T10:00:00+05:30', 'doc')]).source).toBe('legacy');
    expect(migrateMedicine(med({ status: 'stopped' }), []).source).toBe('legacy');
  });

  it('keeps every other field', () => {
    const original = med({ status: 'needs_confirmation', dosesPerDay: null });
    const m = migrateMedicine(original, []);
    for (const key of ['id', 'profileId', 'productName', 'ingredients', 'form', 'dosesPerDay', 'instruction', 'prescriberId', 'sourceDocumentId', 'createdAt', 'updatedAt'] as const) {
      expect(m[key]).toEqual(original[key]);
    }
  });
});

describe('other v1 rows', () => {
  const doc = (overrides: Partial<L.DocumentRecord>): L.DocumentRecord => ({
    id: 'd1', profileId: 'p1', type: 'lab_report', title: 'Lipid profile', documentDate: '2026-11-12', source: 'upload',
    state: 'confirmed', starred: true, prescriberId: null, mimeType: 'application/pdf', sha256: 'a'.repeat(64),
    addedAt: '2026-11-12T18:20:00+05:30', ...overrides,
  });

  it('documents: kind, clinical date and its source, state, source names', () => {
    expect(migrateDocument(doc({}))).toEqual({
      id: 'd1', profileId: 'p1', kind: 'lab_report', title: 'Lipid profile', clinicalDate: '2026-11-12', dateSource: 'document',
      addedAt: '2026-11-12T18:20:00+05:30', receivedAt: null, source: 'upload', state: 'filed', starred: true, prescriberId: null,
      facility: null, tags: [], testNames: [], patientNameRead: null, patientMatch: 'not_found', mimeType: 'application/pdf',
      sha256: 'a'.repeat(64), pageCount: null, pagesRead: null,
    });
    expect(migrateDocument(doc({ source: 'scan', state: 'pending_confirmation' }))).toMatchObject({ source: 'camera', state: 'pending_review' });
    expect(migrateDocument(doc({ source: 'email' }))).toMatchObject({ source: 'email', dateSource: 'email_received', receivedAt: '2026-11-12T18:20:00+05:30' });
  });

  it('prescription lines get their order within each document and a verified flag', () => {
    const line = (id: string, documentId: string, fieldState: L.FieldState): L.PrescriptionLine => ({
      id, documentId, productName: id, ingredients: [], form: 'tablet', dosesPerDay: 1, instruction: '', fieldState,
    });
    const lines = migratePrescriptionLines([line('a', 'd1', 'confirmed'), line('b', 'd2', 'confirmed'), line('c', 'd1', 'extracted')]);
    expect(lines.map((l) => [l.id, l.lineIndex, l.verified])).toEqual([['a', 0, true], ['b', 0, true], ['c', 1, false]]);
  });

  it('events keep id, time, document and wording, with v2 type names', () => {
    const types: [L.MedicationEventType, string][] = [
      ['added', 'added'], ['confirmed', 'confirmed'], ['strength_changed', 'changed'], ['instruction_changed', 'changed'],
      ['flagged_for_review', 'marked_uncertain'], ['marked_stopped', 'stopped'], ['replaced', 'replaced'],
    ];
    for (const [v1, v2] of types) {
      const e = ev(v1, '2026-08-05T12:00:00+05:30', 'doc');
      expect(migrateEvent(e)).toEqual({ ...e, type: v2, proposalId: null, before: null, after: null, undoesEventId: null });
    }
  });

  it('visit questions gain empty links; shares lose no revoke token and have no owner', () => {
    const visit: L.Visit = { id: 'v', profileId: 'p1', prescriberId: 'dr', at: '2026-11-18T10:30:00+05:30', sharedDocumentIds: ['d1'], questions: [{ id: 'q', text: 'Q?', source: 'manual' }] };
    expect(migrateVisit(visit).questions).toEqual([{ id: 'q', text: 'Q?', source: 'manual', medicineId: null, documentId: null }]);
    expect(migrateShare({ id: 's', url: 'https://x/share/s#k', expiresAt: '2026-11-15T00:00:00.000Z', revoked: false, revokeToken: 'secret' }))
      .toEqual({ id: 's', profileId: null, snapshotId: null, url: 'https://x/share/s#k', createdAt: null, expiresAt: '2026-11-15T00:00:00.000Z', revoked: false, revokeToken: 'secret' });
  });
});

describe('migrateV1', () => {
  it('maps every table, adds one migrated event per medicine, drops only what v2 cannot use', () => {
    let n = 0;
    const v1: V1Tables = {
      profiles: [{ id: 'p1', name: 'A', relation: 'Father', birthYear: null, caregiverName: 'B', caregiverRelation: 'son', createdAt: NOW }],
      prescribers: [{ id: 'dr', profileId: 'p1', name: 'Dr. X', specialty: '' }],
      medicines: [med({ id: 'm1' }), med({ id: 'm2', status: 'found_at_home' })],
      events: [ev('added', '2026-08-05T12:00:00+05:30', 'doc', 'm1')],
      documents: [],
      prescriptionLines: [],
      reviewItems: [{ id: 'r', profileId: 'p1', kind: 'confirm_medicine', title: '', body: '', medicineIds: ['m1'], documentId: null, createdAt: NOW, resolvedAt: null, resolution: null }],
      visits: [],
      shares: [],
      settings: [{ key: 'cloudReadingAllowed', value: true }, { key: 'gmailImportedMessageIds', value: ['x'] }],
    };
    const v2 = migrateV1(v1, { now: NOW, newId: () => `new-${(n += 1)}` });
    expect(v2.profiles[0].emergencyContact).toBeNull();
    expect(v2.prescribers).toEqual(v1.prescribers);
    expect(v2.routine.map((m) => [m.id, m.status])).toEqual([['m1', 'uncertain'], ['m2', 'uncertain']]);
    expect(v2.routineEvents.map((e) => [e.id, e.type])).toEqual([['added-2026-08-05T12:00:00+05:30', 'added'], ['new-1', 'migrated'], ['new-2', 'migrated']]);
    expect(v2.routineEvents[1]).toMatchObject({ medicineId: 'm1', at: NOW, after: v2.routine[0], detail: 'Moved to the new medicine list (was: confirmed_current)' });
    expect(v2.settings).toEqual([{ key: 'cloudReadingAllowed', value: true }]);
  });
});
