// @vitest-environment node
// The v2 sample documents in public/sample-docs/, read by the real v2 reader (text layer,
// pdf.js, no OCR, no cloud) through the services, as the demo will.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expected, IDS, SAMPLE_DOCUMENT_FILES, sampleDocuments } from '../../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../../contract/services';
import type { PdfLoader } from '../../reading/pdfText';
import { createRealServicesV2 } from '../createRealServicesV2';
import { CareVaultDbV2 } from '../db/schema';
import { REASONS } from '../rules/verify';
import { readPdfPages } from './pdf';

const legacyPdf: PdfLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as ReturnType<PdfLoader>;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(p: string): Uint8Array; existsSync(p: string): boolean } } })
  .process.getBuiltinModule('node:fs');
const sampleFile = (name: string) => new Blob([fs.readFileSync(`public/sample-docs/${name}`) as BlobPart], { type: 'application/pdf' });

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;

beforeEach(async () => {
  db = new CareVaultDbV2(`sample-docs-test-${(counter += 1)}`);
  services = createRealServicesV2({
    db,
    // The app fetches shipped sample documents from /sample-docs/; here they come from disk.
    fetch: (async (url: string) => new Response(fs.readFileSync(`public${url}`) as BodyInit)) as unknown as typeof fetch,
    reading: {
      pdfPages: (file) => readPdfPages(file, legacyPdf),
      renderPdfPage: async () => {
        throw new Error('A sample document must not need OCR.');
      },
      engines: async () => [],
      cloud: async () => {
        throw new Error('A sample document must not need the cloud.');
      },
    },
  });
  await services.profiles.loadSampleProfile();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('the demo prescription (uploaded during the demo)', () => {
  const demo = expected.demoPrescription;

  it('reads four lines, and flags the smudged Aspirin strength exactly as printed', async () => {
    const { record } = await services.documents.add(IDS.ramesh, sampleFile(demo.file), { source: 'camera' });
    const candidate = await services.reading.read(record.id, { allowCloud: false });
    expect(candidate).toMatchObject({
      engine: 'pdf_text', kind: 'prescription', clinicalDate: demo.clinicalDate, prescriberName: 'Dr. Kavita Rao',
      patientNameRead: 'Ramesh Iyer', patientMatch: 'match', pageCount: 1, pagesRead: 1,
    });
    expect(candidate.lines.map((l) => l.productName)).toEqual(['Amlodipine 10 mg', 'Telmisartan 80 mg', 'Rosuvastatin 10 mg', `Aspirin ${demo.aspirinStrengthAsRead}`]);

    const strengths = candidate.fields.filter((f) => f.field === 'strength');
    expect(strengths.map((f) => [f.lineIndex, f.raw, f.status])).toEqual([
      [0, '10 mg', 'extracted'], [1, '80 mg', 'extracted'], [2, '10 mg', 'extracted'], [3, demo.aspirinStrengthAsRead, 'needs_verification'],
    ]);
    expect(strengths[3]).toMatchObject({ value: null, reasons: [REASONS.unclearDigit], source: 'pdf_text', page: 1 });
    // Nothing else on the page needs a look.
    expect(candidate.fields.filter((f) => f.status === 'needs_verification')).toHaveLength(1);
  });

  it('after the strength is corrected to 75 mg, the lines are exactly the verified lines of the sample case', async () => {
    const { record } = await services.documents.add(IDS.ramesh, sampleFile(demo.file), { source: 'camera' });
    const first = await services.reading.read(record.id, { allowCloud: false });
    const strength = first.fields.find((f) => f.field === 'strength' && f.lineIndex === 3)!;
    await services.documents.reviewFields(record.id, [{ evidenceId: strength.id, action: 'correct', value: '75' }]);
    const again = await services.reading.read(record.id, { allowCloud: false });
    const shape = (lines: typeof again.lines) =>
      lines.map(({ lineIndex, productName, ingredients, form, dosesPerDay, instruction }) => ({ lineIndex, productName, ingredients, form, dosesPerDay, instruction }));
    expect(shape(again.lines)).toEqual(shape([...demo.verifiedLines]));
  });
});

describe('the seeded sample documents', () => {
  it('every sample document has its file', () => {
    for (const doc of sampleDocuments) expect(fs.existsSync(`public/sample-docs/${SAMPLE_DOCUMENT_FILES[doc.id]}`), doc.id).toBe(true);
  });

  it('the emailed HbA1c report has no printed date', async () => {
    const candidate = await services.reading.read(IDS.documents.hba1c, { allowCloud: false });
    expect(candidate).toMatchObject({ kind: 'lab_report', clinicalDate: null, testNames: ['HbA1c'], patientMatch: 'match', facility: 'Lakeside Diagnostics' });
    expect(candidate.fields.some((f) => f.field === 'document_date')).toBe(false);
  });

  it("Lakshmi's thyroid profile is hers", async () => {
    const candidate = await services.reading.read(IDS.documents.lakshmiThyroid, { allowCloud: false });
    expect(candidate).toMatchObject({
      kind: 'lab_report', title: 'Thyroid profile', clinicalDate: '2026-10-02', testNames: ['Thyroid profile'],
      patientNameRead: 'Lakshmi Iyer', patientMatch: 'match', prescriberName: 'Dr. Farah Khan',
    });
  });

  it('each dated sample document reads back the date in the sample case, on the device', async () => {
    for (const doc of sampleDocuments) {
      const candidate = await services.reading.read(doc.id, { allowCloud: false });
      expect(candidate.engine, doc.id).toBe('pdf_text');
      expect(candidate.clinicalDate, doc.id).toBe(doc.clinicalDate);
      expect(candidate.patientMatch, doc.id).toBe('match');
    }
  });
});
