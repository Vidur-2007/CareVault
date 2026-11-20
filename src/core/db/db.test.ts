// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone; jsdom's does not.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDS,
  sampleCase,
  sampleDocuments,
  sampleEvents,
  sampleMedicines,
  samplePrescribers,
  samplePrescriptionLines,
  sampleProfile,
  sampleReviewItems,
  sampleVisit,
} from '../../contract/legacy/fixtures/sampleCase';
import type { MedicineStatus } from '../../contract/legacy/types';
import { createChangeNotifier, type ChangeNotifier } from './events';
import { createRepos, type Repos } from './repos';
import { CareVaultDb, TABLE_NAMES, type StoredShare } from './schema';
import { loadSampleProfile } from './seed';

let counter = 0;
let db: CareVaultDb;
let notifier: ChangeNotifier;
let repos: Repos;

/** Lets the debounced notification (a microtask) run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Same rows, whatever the order (events that share a timestamp have no fixed order). */
function expectSameRows<T extends { id: string }>(actual: T[], wanted: readonly T[]) {
  const byId = (a: T, b: T) => a.id.localeCompare(b.id);
  expect([...actual].sort(byId)).toEqual([...wanted].sort(byId));
}

function expectOldestFirst(rows: { at: string }[]) {
  const times = rows.map((r) => Date.parse(r.at));
  expect(times).toEqual([...times].sort((a, b) => a - b));
}

beforeEach(() => {
  counter += 1;
  db = new CareVaultDb(`carevault-test-${counter}`);
  notifier = createChangeNotifier();
  repos = createRepos(db, notifier);
});

afterEach(async () => {
  await db.delete();
});

describe('schema', () => {
  it('has the tables and indexes from the spec', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort());
    const indexes = (name: string) =>
      db
        .table(name)
        .schema.indexes.map((i) => i.name)
        .sort();
    expect(db.table('profiles').schema.primKey.name).toBe('id');
    expect(indexes('prescribers')).toEqual(['profileId']);
    expect(indexes('medicines')).toEqual(['[profileId+status]', 'profileId']);
    expect(indexes('events')).toEqual(['at', 'medicineId', 'profileId']);
    expect(indexes('documents')).toEqual(['documentDate', 'profileId', 'sha256']);
    expect(indexes('files')).toEqual([]);
    expect(indexes('prescriptionLines')).toEqual(['documentId']);
    expect(indexes('reviewItems')).toEqual(['profileId', 'resolvedAt']);
    expect(indexes('visits')).toEqual(['at', 'profileId']);
    expect(indexes('shares')).toEqual([]);
    expect(db.table('settings').schema.primKey.name).toBe('key');
  });
});

describe('repos round-trip their types', () => {
  it('profiles', async () => {
    await repos.profiles.put(sampleProfile);
    expect(await repos.profiles.get(sampleProfile.id)).toEqual(sampleProfile);
    expect(await repos.profiles.all()).toEqual([sampleProfile]);
    await repos.profiles.delete(sampleProfile.id);
    expect(await repos.profiles.get(sampleProfile.id)).toBeUndefined();
  });

  it('prescribers', async () => {
    await repos.prescribers.bulkPut(samplePrescribers);
    await repos.prescribers.put({ id: 'other', profileId: 'someone-else', name: 'Dr. X', specialty: 'ENT' });
    expect(await repos.prescribers.get(IDS.prescribers.rao)).toEqual(samplePrescribers[0]);
    const mine = await repos.prescribers.byProfile(IDS.profile);
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(expect.arrayContaining(samplePrescribers));
  });

  it('medicines, including the status index', async () => {
    await repos.medicines.bulkPut(sampleMedicines);
    for (const medicine of sampleMedicines) {
      expect(await repos.medicines.get(medicine.id)).toEqual(medicine);
    }
    expect(await repos.medicines.byProfile(IDS.profile)).toHaveLength(sampleMedicines.length);
    const statuses: MedicineStatus[] = ['confirmed_current', 'needs_confirmation', 'found_at_home', 'stopped'];
    for (const status of statuses) {
      const ids = (await repos.medicines.byStatus(IDS.profile, status)).map((m) => m.id).sort();
      expect(ids).toEqual([...sampleCase.expected.medicineIdsByStatus[status]].sort());
    }
    expect(await repos.medicines.byStatus('nobody', 'stopped')).toEqual([]);
  });

  it('events, oldest first', async () => {
    await repos.events.bulkPut([...sampleEvents].reverse());
    const all = await repos.events.byProfile(IDS.profile);
    expectSameRows(all, sampleEvents);
    expectOldestFirst(all);
    const pantoprazole = await repos.events.byMedicine(IDS.medicines.pantoprazole40);
    expect(pantoprazole.map((e) => e.type)).toEqual(['added', 'marked_stopped']);
  });

  it('orders events by instant, not by text, when offsets differ', async () => {
    const base = sampleEvents[0];
    // 10:00 at +05:30 is 04:30 UTC, which is before 05:00 UTC.
    await repos.events.bulkPut([
      { ...base, id: 'later', at: '2026-01-01T05:00:00Z' },
      { ...base, id: 'earlier', at: '2026-01-01T10:00:00+05:30' },
    ]);
    expect((await repos.events.byMedicine(base.medicineId)).map((e) => e.id)).toEqual(['earlier', 'later']);
  });

  it('documents, including lookup by file hash within a profile', async () => {
    await repos.documents.bulkPut(sampleDocuments);
    const lipid = sampleDocuments[0];
    await repos.documents.put({ ...lipid, id: 'same-file-other-profile', profileId: 'someone-else' });
    expect(await repos.documents.get(lipid.id)).toEqual(lipid);
    expect(await repos.documents.byProfile(IDS.profile)).toHaveLength(sampleDocuments.length);
    expect(await repos.documents.bySha256(IDS.profile, lipid.sha256)).toEqual([lipid]);
    expect(await repos.documents.bySha256(IDS.profile, 'f'.repeat(64))).toEqual([]);
  });

  it('files keep the original bytes and type', async () => {
    const blob = new Blob([new Uint8Array([37, 80, 68, 70, 0, 255])], { type: 'application/pdf' });
    await repos.files.put('doc-1', blob);
    const stored = await repos.files.get('doc-1');
    expect(stored).toBeDefined();
    expect(stored!.type).toBe('application/pdf');
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([37, 80, 68, 70, 0, 255]);
    expect(await repos.files.all()).toHaveLength(1);
    await repos.files.delete('doc-1');
    expect(await repos.files.get('doc-1')).toBeUndefined();
  });

  it('prescription lines', async () => {
    await repos.prescriptionLines.bulkPut(samplePrescriptionLines);
    const latest = await repos.prescriptionLines.byDocument(IDS.documents.raoLatest);
    expect(latest.map((l) => l.id).sort()).toEqual(
      [IDS.lines.raoLatestAmlodipine, IDS.lines.raoLatestRosuvastatin, IDS.lines.raoLatestTelmisartan].sort(),
    );
    expect(await repos.prescriptionLines.get(IDS.lines.menonMetformin)).toEqual(samplePrescriptionLines[6]);
  });

  it('review items, open ones oldest first', async () => {
    await repos.reviewItems.bulkPut([...sampleReviewItems].reverse());
    const resolved = {
      ...sampleReviewItems[0],
      id: 'resolved-item',
      resolvedAt: '2026-11-01T10:00:00+05:30',
      resolution: 'still_taking' as const,
    };
    await repos.reviewItems.put(resolved);
    expect(await repos.reviewItems.get(resolved.id)).toEqual(resolved);
    expect(await repos.reviewItems.byProfile(IDS.profile)).toHaveLength(4);
    expect((await repos.reviewItems.openByProfile(IDS.profile)).map((i) => i.id)).toEqual(
      sampleCase.expected.openReviewItemIds,
    );
  });

  it('visits, earliest first', async () => {
    const later = { ...sampleVisit, id: 'later-visit', at: '2026-12-20T09:00:00+05:30' };
    await repos.visits.bulkPut([later, sampleVisit]);
    expect(await repos.visits.get(sampleVisit.id)).toEqual(sampleVisit);
    expect((await repos.visits.byProfile(IDS.profile)).map((v) => v.id)).toEqual([sampleVisit.id, later.id]);
  });

  it('shares keep the revoke token', async () => {
    const share: StoredShare = {
      id: 'share-1',
      url: 'https://example.test/share/share-1#key',
      expiresAt: '2026-11-15T10:00:00.000Z',
      revoked: false,
      revokeToken: 'secret',
    };
    await repos.shares.put(share);
    expect(await repos.shares.get('share-1')).toEqual(share);
    expect(await repos.shares.all()).toEqual([share]);
    await repos.shares.bulkDelete(['share-1']);
    expect(await repos.shares.all()).toEqual([]);
  });

  it('settings', async () => {
    expect(await repos.settings.get<boolean>('cloudReadingAllowed')).toBeUndefined();
    await repos.settings.set('cloudReadingAllowed', true);
    expect(await repos.settings.get<boolean>('cloudReadingAllowed')).toBe(true);
    await repos.settings.set('cloudReadingAllowed', false);
    expect(await repos.settings.all()).toEqual([{ key: 'cloudReadingAllowed', value: false }]);
  });
});

describe('batches', () => {
  it('store every table together', async () => {
    await repos.transaction(async () => {
      await repos.profiles.put(sampleProfile);
      await repos.medicines.bulkPut(sampleMedicines);
      await repos.reviewItems.bulkPut(sampleReviewItems);
    });
    expect(await repos.profiles.all()).toHaveLength(1);
    expect(await repos.medicines.all()).toHaveLength(sampleMedicines.length);
    expect(await repos.reviewItems.all()).toHaveLength(sampleReviewItems.length);
  });

  it('roll back every table together when one step fails', async () => {
    await repos.medicines.put(sampleMedicines[0]);
    const listener = vi.fn();
    await tick();
    notifier.subscribe(listener);

    await expect(
      repos.transaction(async () => {
        await repos.profiles.put(sampleProfile);
        await repos.medicines.put({ ...sampleMedicines[0], status: 'stopped' });
        await repos.events.bulkPut(sampleEvents);
        throw new Error('step failed');
      }),
    ).rejects.toThrow('step failed');
    await tick();

    expect(await repos.profiles.all()).toEqual([]);
    expect(await repos.events.all()).toEqual([]);
    expect((await repos.medicines.get(sampleMedicines[0].id))!.status).toBe(sampleMedicines[0].status);
    expect(listener).not.toHaveBeenCalled();
  });

  it('roll back when a nested batch fails', async () => {
    await expect(
      repos.transaction(async () => {
        await repos.profiles.put(sampleProfile);
        await repos.transaction(async () => {
          await repos.visits.put(sampleVisit);
          throw new Error('inner failed');
        });
      }),
    ).rejects.toThrow('inner failed');
    expect(await repos.profiles.all()).toEqual([]);
    expect(await repos.visits.all()).toEqual([]);
  });

  it('clearAll empties every table', async () => {
    await loadSampleProfile(repos);
    await repos.files.put('doc-1', new Blob(['x']));
    await repos.settings.set('cloudReadingAllowed', true);
    await repos.clearAll();
    for (const table of db.tables) expect(await table.count()).toBe(0);
  });
});

describe('subscribe', () => {
  it('fires once for a single write', async () => {
    const listener = vi.fn();
    notifier.subscribe(listener);
    await repos.profiles.put(sampleProfile);
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires once for a batch of many writes, after the data is stored', async () => {
    const seen: number[] = [];
    notifier.subscribe(() => {
      void repos.medicines.all().then((rows) => seen.push(rows.length));
    });
    const listener = vi.fn();
    notifier.subscribe(listener);

    await repos.transaction(async () => {
      await repos.profiles.put(sampleProfile);
      for (const medicine of sampleMedicines) await repos.medicines.put(medicine);
      await repos.events.bulkPut(sampleEvents);
      expect(listener).not.toHaveBeenCalled();
    });
    await tick();
    await tick();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([sampleMedicines.length]);
  });

  it('fires once per batch across separate batches', async () => {
    const listener = vi.fn();
    notifier.subscribe(listener);
    await repos.profiles.put(sampleProfile);
    await tick();
    await repos.settings.set('cloudReadingAllowed', true);
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not fire for reads, and stops after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = notifier.subscribe(listener);
    await repos.profiles.all();
    await repos.medicines.byProfile(IDS.profile);
    await tick();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await repos.profiles.put(sampleProfile);
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('change notifier', () => {
  it('collapses notifications made in the same tick', async () => {
    const n = createChangeNotifier();
    const listener = vi.fn();
    n.subscribe(listener);
    n.notify();
    n.notify();
    n.notify();
    expect(listener).not.toHaveBeenCalled();
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    n.notify();
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying the others when one listener throws', async () => {
    const n = createChangeNotifier();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    n.subscribe(() => {
      throw new Error('bad listener');
    });
    n.subscribe(second);
    n.notify();
    await tick();
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('loadSampleProfile', () => {
  it('writes the whole sample case', async () => {
    const profile = await loadSampleProfile(repos);
    expect(profile).toEqual(sampleProfile);
    expect(await repos.prescribers.byProfile(IDS.profile)).toHaveLength(2);
    expect(await repos.medicines.byProfile(IDS.profile)).toHaveLength(9);
    expectSameRows(await repos.events.byProfile(IDS.profile), sampleEvents);
    expect(await repos.documents.byProfile(IDS.profile)).toHaveLength(6);
    expect(await repos.prescriptionLines.all()).toHaveLength(7);
    expect((await repos.reviewItems.openByProfile(IDS.profile)).map((i) => i.id)).toEqual(
      sampleCase.expected.openReviewItemIds,
    );
    expect(await repos.visits.byProfile(IDS.profile)).toEqual([sampleVisit]);
  });

  it('is idempotent: calling it twice leaves one copy', async () => {
    await loadSampleProfile(repos);
    const counts = async () => Promise.all(db.tables.map((t) => t.count()));
    const before = await counts();
    const again = await loadSampleProfile(repos);
    expect(again).toEqual(sampleProfile);
    expect(await counts()).toEqual(before);
    expect(await repos.profiles.all()).toHaveLength(1);
  });

  it('keeps what the caregiver changed when called again', async () => {
    await loadSampleProfile(repos);
    const dolo = (await repos.medicines.get(IDS.medicines.dolo650))!;
    await repos.medicines.put({ ...dolo, status: 'confirmed_current' });
    await loadSampleProfile(repos);
    expect((await repos.medicines.get(IDS.medicines.dolo650))!.status).toBe('confirmed_current');
  });

  it('does not store references to the frozen fixtures', async () => {
    await loadSampleProfile(repos);
    const stored = (await repos.visits.get(IDS.visit))!;
    stored.questions.push({ id: 'q', text: 'extra', source: 'manual' });
    expect(sampleVisit.questions).toHaveLength(2);
  });

  it('notifies subscribers once', async () => {
    const listener = vi.fn();
    notifier.subscribe(listener);
    await loadSampleProfile(repos);
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
