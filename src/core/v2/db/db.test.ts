// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone; jsdom's does not.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expected, IDS, sampleCase } from '../../../contract/fixtures/sampleCase';
import { IDS as V1_IDS, sampleMedicines as v1Medicines } from '../../../contract/legacy/fixtures/sampleCase';
import { createChangeNotifier, type ChangeNotifier } from '../../db/events';
import { createRepos } from '../../db/repos';
import { CareVaultDb } from '../../db/schema';
import { loadSampleProfile as loadV1Sample } from '../../db/seed';
import { createReposV2, type ReposV2 } from './repos';
import { CareVaultDbV2, TABLE_NAMES_V2 } from './schema';
import { loadSampleProfiles } from './seed';

let counter = 0;
let db: CareVaultDbV2;
let notifier: ChangeNotifier;
let repos: ReposV2;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const nextName = () => `carevault-v2-test-${(counter += 1)}`;

beforeEach(() => {
  db = new CareVaultDbV2(nextName());
  notifier = createChangeNotifier();
  repos = createReposV2(db, notifier);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('schema v2', () => {
  it('has the v2 tables and indexes, and no v1-only tables', async () => {
    await db.open();
    expect(db.verno).toBe(3);
    expect(db.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES_V2].sort());
    const indexes = (name: string) => db.table(name).schema.indexes.map((i) => i.name).sort();
    expect(indexes('documents')).toEqual(['[profileId+sha256]', 'clinicalDate', 'profileId']);
    expect(indexes('routine')).toEqual(['[profileId+status]', 'profileId']);
    expect(indexes('fieldEvidence')).toEqual(['documentId', 'profileId']);
    expect(indexes('shares')).toEqual(['profileId']);
    expect(indexes('gmailImports')).toEqual(['documentId', 'profileId']);
    expect(db.table('gmailImports').schema.primKey.name).toBe('[profileId+messageId+attachmentId]');
    for (const name of TABLE_NAMES_V2) {
      if (name === 'settings' || name === 'gmailImports' || name === 'profiles' || name === 'files') continue;
      if (name === 'prescriptionLines') continue;
      expect(indexes(name), name).toContain('profileId');
    }
  });
});

describe('repos v2 round-trip every type', () => {
  it('the whole sample case, per table', async () => {
    await loadSampleProfiles(repos);
    expect(await repos.profiles.all()).toEqual(expect.arrayContaining([...sampleCase.profiles]));
    expect(await repos.profiles.all()).toHaveLength(sampleCase.profiles.length);
    expect(await repos.prescribers.all()).toEqual(expect.arrayContaining([...sampleCase.prescribers]));
    for (const d of sampleCase.documents) expect(await repos.documents.get(d.id)).toEqual(d);
    for (const m of sampleCase.routine) expect(await repos.routine.get(m.id)).toEqual(m);
    for (const e of sampleCase.routineEvents) expect(await repos.routineEvents.get(e.id)).toEqual(e);
    for (const h of sampleCase.healthEntries) expect(await repos.healthEntries.get(h.id)).toEqual(h);
    expect(await repos.visits.get(IDS.visit)).toEqual(sampleCase.visits[0]);
    expect((await repos.prescriptionLines.byDocument(IDS.documents.raoLatest)).map((l) => l.lineIndex)).toEqual([0, 1, 2]);
  });

  it('profile-scoped reads never return another profile', async () => {
    await loadSampleProfiles(repos);
    for (const id of [IDS.ramesh, IDS.lakshmi]) {
      for (const rows of [await repos.documents.byProfile(id), await repos.routine.byProfile(id), await repos.routineEvents.byProfile(id), await repos.healthEntries.byProfile(id), await repos.prescribers.byProfile(id)]) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.profileId === id)).toBe(true);
      }
    }
    expect((await repos.routine.byProfile(IDS.lakshmi)).map((m) => m.productName)).toEqual(['Levothyroxine 50 mcg']);
  });

  it('documents by hash stay within the profile', async () => {
    await loadSampleProfiles(repos);
    const lipid = sampleCase.documents.find((d) => d.id === IDS.documents.lipidProfile)!;
    await repos.documents.put({ ...lipid, id: 'copy-for-lakshmi', profileId: IDS.lakshmi });
    expect((await repos.documents.bySha256(IDS.ramesh, lipid.sha256)).map((d) => d.id)).toEqual([lipid.id]);
    expect((await repos.documents.bySha256(IDS.lakshmi, lipid.sha256)).map((d) => d.id)).toEqual(['copy-for-lakshmi']);
  });

  it('routine by status, events oldest first', async () => {
    await loadSampleProfiles(repos);
    const status = expected.ramesh.routineStatusById;
    const taking = (await repos.routine.byStatus(IDS.ramesh, 'taking')).map((m) => m.id).sort();
    expect(taking).toEqual(Object.keys(status).filter((id) => status[id] === 'taking').sort());
    const times = (await repos.routineEvents.byProfile(IDS.ramesh)).map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('files, field evidence, proposals, snapshots, shares, Gmail imports and settings', async () => {
    await repos.files.put('d1', new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }));
    expect([...new Uint8Array(await (await repos.files.get('d1'))!.arrayBuffer())]).toEqual([37, 80, 68, 70]);

    const evidence = {
      id: 'f1', profileId: 'p1', documentId: 'd1', field: 'strength' as const, lineIndex: 0, ingredientIndex: 0, page: 1,
      raw: '6?0 mg', value: null, status: 'needs_verification' as const, reasons: ['Unclear digit'], source: 'ocr' as const,
      confidence: 0.41, region: { x: 1, y: 2, width: 3, height: 4 }, reviewedAt: null,
    };
    await repos.fieldEvidence.put(evidence);
    expect(await repos.fieldEvidence.byDocument('d1')).toEqual([evidence]);
    await repos.fieldEvidence.deleteByDocument('d1');
    expect(await repos.fieldEvidence.byDocument('d1')).toEqual([]);

    const proposal = { id: 'pr', profileId: 'p1', documentId: 'd1', prescriberId: null, createdAt: '2026-11-13T10:00:00+05:30', routineRevision: 3, rows: [], passiveNotMentionedCount: 0, status: 'open' as const };
    await repos.proposals.put(proposal);
    expect(await repos.proposals.byDocument('d1')).toEqual([proposal]);

    const passport = { profileId: 'p1' } as never;
    await repos.snapshots.bulkPut([
      { id: 's1', profileId: 'p1', createdAt: '2026-11-13T10:00:00+05:30', reason: 'print', passport, revision: 1 },
      { id: 's2', profileId: 'p1', createdAt: '2026-11-14T10:00:00+05:30', reason: 'share', passport, revision: 2 },
    ]);
    expect((await repos.snapshots.byProfile('p1')).map((s) => s.id)).toEqual(['s2', 's1']);

    await repos.shares.bulkPut([
      { id: 'mine', profileId: 'p1', snapshotId: 's2', url: 'u', createdAt: null, expiresAt: 'e', revoked: false, revokeToken: 't1' },
      { id: 'old', profileId: null, snapshotId: null, url: 'u', createdAt: null, expiresAt: 'e', revoked: false, revokeToken: 't2' },
    ]);
    expect((await repos.shares.byProfile('p1')).map((s) => s.id)).toEqual(['mine']);
    expect((await repos.shares.unowned()).map((s) => s.id)).toEqual(['old']);

    await repos.gmailImports.bulkPut([
      { profileId: 'p1', messageId: 'm', attachmentId: 'a1', documentId: 'd1', importedAt: 'x' },
      { profileId: 'p1', messageId: 'm', attachmentId: 'a2', documentId: 'd2', importedAt: 'x' },
      { profileId: 'p2', messageId: 'm', attachmentId: 'a1', documentId: 'd3', importedAt: 'x' },
    ]);
    expect((await repos.gmailImports.get('p1', 'm', 'a2'))?.documentId).toBe('d2');
    expect((await repos.gmailImports.byProfile('p1')).map((g) => g.attachmentId)).toEqual(['a1', 'a2']);
    expect(await repos.gmailImports.get('p2', 'm', 'a2')).toBeUndefined();

    await repos.settings.set('cloudReadingAllowed', true);
    expect(await repos.settings.get<boolean>('cloudReadingAllowed')).toBe(true);
  });

  it('the routine revision is per profile and only goes up', async () => {
    expect(await repos.routineRevision.get('p1')).toBe(0);
    expect(await repos.routineRevision.bump('p1')).toBe(1);
    expect(await repos.routineRevision.bump('p1')).toBe(2);
    expect(await repos.routineRevision.get('p2')).toBe(0);
  });
});

describe('batches and notifications', () => {
  it('a failing batch rolls back every table, including the revision', async () => {
    await loadSampleProfiles(repos);
    const listener = vi.fn();
    await tick();
    notifier.subscribe(listener);
    await expect(repos.transaction(async () => {
      await repos.routine.put({ ...sampleCase.routine[0], status: 'stopped' });
      await repos.routineRevision.bump(IDS.ramesh);
      await repos.healthEntries.bulkDelete([IDS.health.sulfaAllergy]);
      throw new Error('step failed');
    })).rejects.toThrow('step failed');
    await tick();
    expect((await repos.routine.get(sampleCase.routine[0].id))!.status).toBe('taking');
    expect(await repos.routineRevision.get(IDS.ramesh)).toBe(0);
    expect(await repos.healthEntries.get(IDS.health.sulfaAllergy)).toBeDefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribers hear once per batch, after it is stored', async () => {
    const listener = vi.fn();
    notifier.subscribe(listener);
    await loadSampleProfiles(repos);
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    await repos.routineRevision.bump(IDS.ramesh);
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clearAll empties every table', async () => {
    await loadSampleProfiles(repos);
    await repos.clearAll();
    for (const table of db.tables) expect(await table.count()).toBe(0);
  });
});

describe('loadSampleProfiles', () => {
  it('writes both profiles, and is idempotent', async () => {
    expect((await loadSampleProfiles(repos)).id).toBe(IDS.ramesh);
    const counts = () => Promise.all(db.tables.map((t) => t.count()));
    const before = await counts();
    await loadSampleProfiles(repos);
    expect(await counts()).toEqual(before);
    expect((await repos.profiles.all()).map((p) => p.id).sort()).toEqual([IDS.lakshmi, IDS.ramesh]);
  });

  it('keeps the user\'s changes, and adds a sample profile that was removed', async () => {
    await loadSampleProfiles(repos);
    await repos.routine.put({ ...sampleCase.routine[0], status: 'stopped' });
    await repos.profiles.delete(IDS.lakshmi);
    await loadSampleProfiles(repos);
    expect((await repos.routine.get(sampleCase.routine[0].id))!.status).toBe('stopped');
    expect(await repos.profiles.get(IDS.lakshmi)).toBeDefined();
  });
});

describe('upgrading a populated v1 database in place', () => {
  async function buildV1(name: string) {
    const v1 = new CareVaultDb(name);
    const v1Repos = createRepos(v1, createChangeNotifier());
    await loadV1Sample(v1Repos);
    // Cases the v1 sample does not cover.
    await v1Repos.files.put(V1_IDS.documents.ecg, new Blob(['%PDF-1.4 ecg'], { type: 'application/pdf' }));
    await v1Repos.shares.put({ id: 'v1-share', url: 'https://x/share/v1-share#key', expiresAt: '2026-11-20T00:00:00.000Z', revoked: false, revokeToken: 'v1-token' });
    await v1Repos.settings.set('cloudReadingAllowed', true);
    await v1Repos.settings.set('gmailImportedMessageIds', ['msg-1']);
    // Dolo confirmed by the caregiver in v1.
    const dolo = (await v1Repos.medicines.get(V1_IDS.medicines.dolo650))!;
    await v1Repos.medicines.put({ ...dolo, status: 'confirmed_current' });
    await v1Repos.events.put({ id: 'v1-dolo-confirmed', profileId: dolo.profileId, medicineId: dolo.id, type: 'confirmed', at: '2026-11-11T09:00:00+05:30', documentId: null, detail: 'Confirmed by the caregiver' });
    const snapshot = Object.fromEntries(await Promise.all(v1.tables.map(async (t) => [t.name, await t.toArray()]))) as Record<string, { id?: string }[]>;
    v1.close();
    return snapshot;
  }

  it('loses nothing and maps every medicine as the spec says', async () => {
    const name = nextName();
    const v1 = await buildV1(name);
    let n = 0;
    const upgraded = new CareVaultDbV2(name, { now: () => new Date('2026-11-20T10:00:00Z'), newId: () => `migrated-${(n += 1)}` });
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    expect(upgraded.tables.map((t) => t.name)).not.toContain('medicines');

    // Nothing lost: every v1 row has its v2 counterpart under the same id.
    const v2Ids = async (table: string) => (await upgraded.table(table).toArray()).map((r: { id: string }) => r.id).sort();
    const v1Ids = (table: string) => v1[table].map((r) => r.id!).sort();
    expect(await v2Ids('profiles')).toEqual(v1Ids('profiles'));
    expect(await v2Ids('prescribers')).toEqual(v1Ids('prescribers'));
    expect(await v2Ids('documents')).toEqual(v1Ids('documents'));
    expect(await v2Ids('prescriptionLines')).toEqual(v1Ids('prescriptionLines'));
    expect(await v2Ids('visits')).toEqual(v1Ids('visits'));
    expect(await v2Ids('routine')).toEqual(v1Ids('medicines'));
    expect(await v2Ids('files')).toEqual(v1Ids('files'));
    const events = await upgraded.routineEvents.toArray();
    for (const id of v1Ids('events')) expect(events.some((e) => e.id === id)).toBe(true);
    expect(events.filter((e) => e.type === 'migrated')).toHaveLength(v1Medicines.length);
    expect(events).toHaveLength(v1Ids('events').length + v1Medicines.length);

    // Questions, files, revoke tokens and settings survive.
    expect((await upgraded.visits.get(V1_IDS.visit))!.questions.map((q) => q.text)).toEqual(v1.visits.length ? (v1.visits[0] as unknown as { questions: { text: string }[] }).questions.map((q) => q.text) : []);
    expect(await (await upgraded.files.get(V1_IDS.documents.ecg))!.blob.text()).toBe('%PDF-1.4 ecg');
    expect(await upgraded.shares.get('v1-share')).toMatchObject({ profileId: null, snapshotId: null, revokeToken: 'v1-token' });
    expect(await upgraded.settings.get('cloudReadingAllowed')).toEqual({ key: 'cloudReadingAllowed', value: true });
    expect(await upgraded.settings.get('gmailImportedMessageIds')).toBeUndefined();

    // Medicines, per overview section 9.9.
    const status = async (id: string) => {
      const m = (await upgraded.routine.get(id))!;
      return [m.status, m.source, m.legacyReviewPending, m.legacyStatus];
    };
    const M = V1_IDS.medicines;
    expect(await status(M.dolo650)).toEqual(['taking', 'caregiver_reported', false, 'confirmed_current']);
    expect(await status(M.amlodipine10)).toEqual(['uncertain', 'legacy', true, 'confirmed_current']);
    expect(await status(M.metformin500)).toEqual(['uncertain', 'legacy', true, 'confirmed_current']);
    expect(await status(M.atorvastatin10)).toEqual(['uncertain', 'legacy', true, 'needs_confirmation']);
    expect(await status(M.crocinAdvance500)).toEqual(['uncertain', 'from_pack', true, 'found_at_home']);
    expect(await status(M.pantoprazole40)).toEqual(['stopped', 'caregiver_reported', false, 'stopped']);
    expect(await status(M.amlodipine5)).toEqual(['stopped', 'legacy', false, 'stopped']);
    expect((await upgraded.routine.get(M.amlodipine5))!.replacedByMedicineId).toBe(M.amlodipine10);

    // Documents and lines.
    const hba1c = (await upgraded.documents.get(V1_IDS.documents.hba1c))!;
    expect(hba1c).toMatchObject({ source: 'email', dateSource: 'email_received', state: 'pending_review', kind: 'lab_report' });
    expect((await upgraded.documents.get(V1_IDS.documents.raoLatest))!).toMatchObject({ source: 'camera', state: 'filed', kind: 'prescription' });
    const lines = await upgraded.prescriptionLines.where('documentId').equals(V1_IDS.documents.raoLatest).toArray();
    expect(lines.map((l) => l.lineIndex).sort()).toEqual([0, 1, 2]);
    expect(lines.every((l) => l.verified)).toBe(true);

    upgraded.close();
    await upgraded.delete();
  });

  it('an empty v1 database upgrades to an empty v2 database', async () => {
    const name = nextName();
    const v1 = new CareVaultDb(name);
    await v1.open();
    v1.close();
    const upgraded = new CareVaultDbV2(name);
    await upgraded.open();
    for (const table of upgraded.tables) expect(await table.count()).toBe(0);
    upgraded.close();
    await upgraded.delete();
  });

  it('the upgraded database works with the v2 repos', async () => {
    const name = nextName();
    await buildV1(name);
    const upgraded = new CareVaultDbV2(name);
    const r = createReposV2(upgraded, createChangeNotifier());
    expect((await r.routine.byProfile(V1_IDS.profile)).length).toBe(v1Medicines.length);
    // The v1 and v2 sample profiles share an id. The seed is idempotent, so on an upgraded
    // device the migrated v1 sample stays as it is (the user's data), and only Lakshmi is added.
    expect(V1_IDS.profile).toBe(IDS.ramesh);
    await loadSampleProfiles(r);
    expect((await r.profiles.all()).map((p) => p.id).sort()).toEqual([IDS.lakshmi, IDS.ramesh]);
    expect((await r.routine.byProfile(IDS.ramesh)).every((m) => m.legacyStatus !== null)).toBe(true);
    upgraded.close();
    await upgraded.delete();
  });
});
