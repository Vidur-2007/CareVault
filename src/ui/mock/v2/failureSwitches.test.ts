// One test per localStorage.cvMockFail switch of the v2 mock (UI spec section 5).
import { afterEach, describe, expect, it } from 'vitest';
import { expected, IDS } from '../../../contract/fixtures/sampleCase';
import type { ServiceError } from '../../../contract/types';
import { placeholderPdf } from '../placeholderPdf';
import { createMockServicesV2 } from './createMockServicesV2';

const M = IDS.medicines;
const demo = expected.demoPrescription;

/** A mock whose switch can be flipped during a test. */
function withSwitch() {
  let value: string | null = null;
  const services = createMockServicesV2({ delayMs: 0, fail: () => value });
  return { s: services, set: (v: string | null) => { value = v; } };
}

async function rejectsWith(promise: Promise<unknown>, code: ServiceError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

const pdf = (name: string) => new File([placeholderPdf([name])], name, { type: 'application/pdf' });

afterEach(() => {
  localStorage.removeItem('cvMockFail');
});

describe('cvMockFail switches', () => {
  it('a group name fails only that group, with network', async () => {
    const { s, set } = withSwitch();
    set('documents');
    await rejectsWith(s.documents.list(IDS.ramesh), 'network');
    await rejectsWith(s.documents.file(IDS.documents.lipidProfile), 'network');
    expect(await s.routine.list(IDS.ramesh)).toHaveLength(9);
    set('routine, passport');
    await rejectsWith(s.routine.list(IDS.ramesh), 'network');
    await rejectsWith(s.passport.live(IDS.ramesh), 'network');
    expect(await s.documents.list(IDS.ramesh)).toHaveLength(6);
    set(null);
    expect(await s.passport.live(IDS.ramesh)).toBeTruthy();
  });

  it("'all' fails every group", async () => {
    const { s, set } = withSwitch();
    set('all');
    await rejectsWith(s.profiles.list(), 'network');
    await rejectsWith(s.records.ask(IDS.ramesh, 'latest lipid profile'), 'network');
    await rejectsWith(s.attention.list(IDS.ramesh), 'network');
    await rejectsWith(s.settings.get(), 'network');
    await rejectsWith(s.sharing.listUnowned(), 'network');
  });

  it("'reading' fails reading.read only, and the original stays stored", async () => {
    const { s, set } = withSwitch();
    const { record } = await s.documents.add(IDS.ramesh, pdf(demo.file), { source: 'upload' });
    set('reading');
    await rejectsWith(s.reading.read(record.id, { allowCloud: false }), 'network');
    expect((await s.documents.get(record.id)).state).toBe('pending_review');
    expect((await s.documents.file(record.id)).blob.size).toBeGreaterThan(0);
  });

  it("'stale' makes decide and undo reject with stale", async () => {
    const { s, set } = withSwitch();
    const { record } = await s.documents.add(IDS.ramesh, pdf(demo.file), { source: 'upload' });
    const candidate = await s.reading.read(record.id, { allowCloud: false });
    const { proposal } = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    await s.routine.setStatus(M.dolo650, 'stopped');
    const event = (await s.routine.history(M.dolo650)).at(-1)!;
    set('stale');
    const revision = await s.routine.revision(IDS.ramesh);
    await rejectsWith(s.routine.decide(proposal!.id, [{ rowId: proposal!.rows[0].id, choice: 'skip' }], revision), 'stale');
    await rejectsWith(s.routine.undo(event.id), 'stale');
    // proposalFor returns the refreshed proposal at the current revision.
    expect((await s.routine.proposalFor(record.id))?.routineRevision).toBe(revision);
    set(null);
    expect((await s.routine.decide(proposal!.id, [{ rowId: proposal!.rows[0].id, choice: 'skip' }], revision)).proposal.rows[0].decision).toBe('skip');
  });

  it("'locked' makes reading a PDF reject with locked_pdf; the record can still be filed", async () => {
    const { s, set } = withSwitch();
    const { record } = await s.documents.add(IDS.ramesh, pdf('report.pdf'), { source: 'upload' });
    set('locked');
    await rejectsWith(s.reading.read(record.id, { allowCloud: false }), 'locked_pdf');
    expect((await s.documents.fileRecord(record.id)).state).toBe('filed');
    // Photos are not PDFs.
    const photo = new File([new Uint8Array([9])], 'pack.jpg', { type: 'image/jpeg' });
    const added = await s.documents.add(IDS.ramesh, photo, { source: 'camera' });
    expect((await s.reading.read(added.record.id, { allowCloud: false })).lines).toHaveLength(1);
  });

  it("'cloud_consent' needs allowCloud, then reads with the cloud engine and every field needs a look", async () => {
    const { s, set } = withSwitch();
    const { record } = await s.documents.add(IDS.ramesh, pdf(demo.file), { source: 'upload' });
    set('cloud_consent');
    await rejectsWith(s.reading.read(record.id, { allowCloud: false }), 'cloud_consent_required');
    const candidate = await s.reading.read(record.id, { allowCloud: true });
    expect(candidate.engine).toBe('cloud');
    expect(candidate.fields.length).toBeGreaterThan(0);
    expect(candidate.fields.every((f) => f.status === 'needs_verification' && f.source === 'cloud')).toBe(true);
  });

  it("'verification' makes value-writing routine changes from a document reject; other answers still work", async () => {
    const { s, set } = withSwitch();
    const { record } = await s.documents.add(IDS.ramesh, pdf(demo.file), { source: 'upload' });
    const candidate = await s.reading.read(record.id, { allowCloud: false });
    await s.documents.reviewFields(record.id, candidate.fields.map((f) => ({ evidenceId: f.id, action: 'correct' as const, value: f.value ?? '75' })));
    const { proposal } = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    const p = proposal!;
    set('verification');
    await rejectsWith(s.routine.decide(p.id, [{ rowId: p.rows[0].id, choice: 'started_new' }], p.routineRevision), 'verification_required');
    await rejectsWith(s.routine.add(IDS.ramesh, candidate.lines[0], { status: 'taking', source: 'from_pack', documentId: record.id }), 'verification_required');
    const notMentioned = p.rows.find((r) => r.kind === 'not_mentioned')!;
    const result = await s.routine.decide(p.id, [{ rowId: notMentioned.id, choice: 'skip' }], p.routineRevision);
    expect(result.proposal.rows.find((r) => r.id === notMentioned.id)?.decision).toBe('skip');
    // Typed by the user: never gated.
    expect((await s.routine.add(IDS.ramesh, candidate.lines[0], { status: 'taking', source: 'caregiver_reported', documentId: null })).status).toBe('taking');
  });

  it('reads the switch from localStorage when no override is given', async () => {
    const s = createMockServicesV2({ delayMs: 0 });
    localStorage.setItem('cvMockFail', 'profiles');
    await rejectsWith(s.profiles.list(), 'network');
    localStorage.removeItem('cvMockFail');
    expect(await s.profiles.list()).toHaveLength(2);
  });

  it('waits between 300 and 800 ms by default', async () => {
    const s = createMockServicesV2({ fail: () => null });
    const started = performance.now();
    await s.profiles.list();
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(290);
    expect(took).toBeLessThan(1500);
  });
});
