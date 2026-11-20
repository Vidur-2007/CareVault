// @vitest-environment node
// The golden test of v2 (overview section 10): the sample case replayed through the real
// services, with the demo prescription read from its PDF by the real reader on the device.
// Every value comes from fixtures `expected`.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expected, IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import type { ProposalRow, RoutineMedicine, RoutineProposal, RowDecision, ServiceError } from '../../contract/types';
import type { PdfLoader } from '../reading/pdfText';
import { createRealServicesV2 } from './createRealServicesV2';
import { CareVaultDbV2 } from './db/schema';
import { readPdfPages } from './reading/pdf';

const legacyPdf: PdfLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as ReturnType<PdfLoader>;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(p: string): Uint8Array } } }).process.getBuiltinModule('node:fs');
const sampleFile = (name: string) => new Blob([fs.readFileSync(`public/sample-docs/${name}`) as BlobPart], { type: 'application/pdf' });

const demo = expected.demoPrescription;
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;

beforeEach(async () => {
  let ms = Date.parse('2026-11-14T09:00:00+05:30');
  db = new CareVaultDbV2(`golden-v2-test-${(counter += 1)}`);
  services = createRealServicesV2({
    db,
    now: () => new Date((ms += 1000)),
    fetch: (async (url: string) => new Response(fs.readFileSync(`public${url}`) as BodyInit)) as unknown as typeof fetch,
    reading: {
      pdfPages: (file) => readPdfPages(file, legacyPdf),
      renderPdfPage: async () => {
        throw new Error('The demo prescription must not need OCR.');
      },
      engines: async () => [],
      cloud: async () => {
        throw new Error('The demo prescription must not need the cloud.');
      },
    },
  });
  await services.profiles.loadSampleProfile();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

function rowOf(proposal: RoutineProposal, decision: (typeof demo.decisions)[number]): ProposalRow {
  const row = 'medicineId' in decision
    ? proposal.rows.find((r) => r.line === null && r.medicine?.id === decision.medicineId)
    : proposal.rows.find((r) => r.line?.productName === decision.lineProductName);
  if (!row) throw new Error(`No row for ${JSON.stringify(decision)}`);
  return row;
}

describe('golden: the sample case, v2', () => {
  it('before the demo: ingredient totals and the routine as reported', async () => {
    expect(await services.routine.ingredientTotals(IDS.ramesh)).toEqual(expected.ramesh.ingredientTotals);
    expect(expected.ramesh.ingredientTotals.map((t) => [t.ingredient, t.perDay, t.unit, t.complete])).toEqual([['paracetamol', 3450, 'mg', true]]);
    const taking = (await services.routine.list(IDS.ramesh)).filter((m) => m.status === 'taking').map((m) => m.productName);
    expect(new Set(taking)).toEqual(new Set(expected.ramesh.passport.currentMedicineNames));
  });

  it('the demo prescription: read, saved, checked and decided', async () => {
    const before = new Map((await services.routine.list(IDS.ramesh)).map((m) => [m.id, m]));
    const lakshmiBefore = await services.routine.list(IDS.lakshmi);
    const eventsBefore = (await services.routine.profileHistory(IDS.ramesh)).length;

    // 1. Upload and read on the device.
    const { record } = await services.documents.add(IDS.ramesh, sampleFile(demo.file), { source: 'camera' });
    const candidate = await services.reading.read(record.id, { allowCloud: false });
    expect(candidate.prescriberName).toBe('Dr. Kavita Rao');

    // 2. Save with Dr. Rao: lines stored, routine untouched.
    const saved = await services.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
    expect((await services.routine.profileHistory(IDS.ramesh)).length).toBe(eventsBefore);
    expect(new Map((await services.routine.list(IDS.ramesh)).map((m) => [m.id, m]))).toEqual(before);

    const proposal = saved.proposal!;
    const rowsAsFixture = (p: RoutineProposal) =>
      p.rows.map((r) => ({ kind: r.kind, lineProductName: r.line?.productName ?? null, medicineId: r.kind === 'new' ? null : r.medicine?.id ?? null, asked: r.asked, blockedByVerification: r.blockedByVerification }));
    // Before the check: Aspirin exactly as printed, and blocked.
    expect(rowsAsFixture(proposal)).toEqual(demo.proposalRows);
    expect(proposal.passiveNotMentionedCount).toBe(demo.passiveNotMentionedCount);
    const aspirin = proposal.rows.find((r) => r.kind === 'new')!;
    expect(aspirin.line).toMatchObject({ productName: `Aspirin ${demo.aspirinStrengthAsRead}`, verified: false });
    // The unchecked value can never reach the routine.
    const refused = await services.routine.decide(proposal.id, [{ rowId: aspirin.id, choice: 'started' }], proposal.routineRevision).catch((e: ServiceError) => e);
    expect(refused).toMatchObject({ code: 'verification_required' });
    expect(new Map((await services.routine.list(IDS.ramesh)).map((m) => [m.id, m]))).toEqual(before);
    expect((await services.routine.profileHistory(IDS.ramesh)).length).toBe(eventsBefore);
    expect((await services.routine.list(IDS.ramesh)).some((m) => m.productName.startsWith('Aspirin'))).toBe(false);
    // A batch that includes the blocked row is refused as a whole: Telmisartan is not changed either.
    expect(await codeOf(services.routine.decide(proposal.id, [{ rowId: aspirin.id, choice: 'started' }, { rowId: proposal.rows[0].id, choice: 'started_new' }], proposal.routineRevision))).toBe('verification_required');
    expect((await services.routine.get(IDS.medicines.telmisartan40)).status).toBe('taking');

    // 3. Check the value: the strength is corrected to 75 mg.
    const strength = (await services.documents.fields(record.id)).find((f) => f.field === 'strength' && f.lineIndex === aspirin.line!.lineIndex)!;
    expect(strength.status).toBe('needs_verification');
    await services.documents.reviewFields(record.id, [{ evidenceId: strength.id, action: 'correct', value: '75' }]);
    const checked = (await services.routine.proposalFor(record.id))!;
    expect(checked.id).toBe(proposal.id);
    expect(rowsAsFixture(checked)).toEqual(demo.proposalRowsAfterCheck);
    const lines = await services.prescriptions.lines(record.id);
    expect(lines.map(({ lineIndex, productName, ingredients, form, dosesPerDay, instruction }) => ({ lineIndex, productName, ingredients, form, dosesPerDay, instruction })))
      .toEqual(demo.verifiedLines.map(({ lineIndex, productName, ingredients, form, dosesPerDay, instruction }) => ({ lineIndex, productName, ingredients, form, dosesPerDay, instruction })));
    expect(lines.every((l) => l.verified)).toBe(true);

    // 4. The decisions of the sample case.
    const decisions: RowDecision[] = demo.decisions.map((d) => ({ rowId: rowOf(checked, d).id, choice: d.choice }));
    const result = await services.routine.decide(checked.id, decisions, checked.routineRevision);
    expect(result.questionsAdded).toEqual([]);

    const after = await services.routine.list(IDS.ramesh);
    const byId = new Map(after.map((m) => [m.id, m]));
    expect(new Set(after.filter((m) => m.status === 'taking').map((m) => m.productName))).toEqual(new Set(demo.afterDecisions.currentMedicineNames));
    for (const stopped of demo.afterDecisions.newlyStopped) {
      const entry = byId.get(stopped.medicineId)!;
      expect(entry.status).toBe('stopped');
      expect(byId.get(entry.replacedByMedicineId!)!.productName).toBe(stopped.replacedByProductName);
    }
    for (const id of demo.afterDecisions.unchangedIds) expect(byId.get(id), id).toEqual(before.get(id));
    expect(byId.get(IDS.medicines.atorvastatin10)!.status).toBe(demo.afterDecisions.atorvastatinStatus);
    const added: RoutineMedicine[] = after.filter((m) => !before.has(m.id));
    expect(added.map((m) => [m.productName, m.status, m.source, m.prescriberId, m.sourceDocumentId]).sort()).toEqual([
      ['Aspirin 75 mg', 'taking', 'from_prescription', demo.prescriberId, record.id],
      ['Telmisartan 80 mg', 'taking', 'from_prescription', demo.prescriberId, record.id],
    ]);
    // Atorvastatin was skipped: the review stays open for it, and nothing else waits.
    expect(result.proposal.status).toBe('open');

    // 5. Lakshmi is untouched.
    expect(await services.routine.list(IDS.lakshmi)).toEqual(lakshmiBefore);
    expect(await db.proposals.where('profileId').equals(IDS.lakshmi).count()).toBe(0);
    expect(await services.routine.ingredientTotals(IDS.lakshmi)).toEqual(expected.lakshmi.ingredientTotals);
  });
});
