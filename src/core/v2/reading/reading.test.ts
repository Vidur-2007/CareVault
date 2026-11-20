// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ServiceError as V1ServiceError } from '../../../contract/legacy/types';
import { ServiceError, type ExtractionCandidate } from '../../../contract/types';
import type { PdfLoader } from '../../reading/pdfText';
import { linesFromPaddle, linesFromTesseract, type OcrEngineV2, type OcrPage } from './ocr';
import { findIngredients, findStrengths, parsePages, recognisedSomething, titleCase, WARNING_FROM_REFERENCE, WARNING_NO_FREQUENCY } from './parse';
import { readPdfPages, textItemsToLines } from './pdf';
import { MAX_OCR_PAGES, needsCloud, parsedFromCloud, readFile, toV2Error, type ReadingDepsV2 } from './read';

const legacyPdf: PdfLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as ReturnType<PdfLoader>;
async function fixture(name: string, type: string): Promise<Blob> {
  const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(p: string): Uint8Array } } }).process.getBuiltinModule('node:fs');
  return new Blob([fs.readFileSync(`src/core/v2/reading/fixtures/${name}`) as BlobPart], { type });
}

const PACK = `DOLO 650
Paracetamol Tablets IP 650 mg
Each uncoated tablet contains:
Paracetamol IP 650 mg
Mfd. 06/2026  Exp. 05/2029`;

const PRESCRIPTION = `Sunrise Heart and Diabetes Clinic
Dr. Kavita Rao MD, DM            Date: 28/10/2026
Patient: Ramesh Iyer  Age: 71 years
Rx
1. Tab. Amlodipine 10 mg   1-0-0   30 days
2. Tab. Metformin 500 mg   1-0-1   90 days
3. Tab. Aspirin 7? mg   0-1-0
4. Tab. Telma 40   1-0-0`;

const LAB = `Lakeside Diagnostics
Lab report: Lipid profile
Patient: Ramesh Iyer   DOB: 02/03/1955
Date: 12 Nov 2026      Referred by: Dr. Kavita Rao
Total cholesterol 186 mg/dL`;

describe('parse v2', () => {
  it('a pack label with a composition line', () => {
    const d = parsePages([{ page: 1, text: PACK }]);
    expect(d).toMatchObject({ kind: 'other', clinicalDate: null, dateUnclear: false, prescriberName: null });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({
      page: 1, sourceText: 'DOLO 650', productName: 'Dolo 650', form: 'tablet', dosesPerDay: null, instruction: '', doseRaw: null,
      ingredients: [{ name: 'paracetamol', nameRaw: 'Paracetamol', strength: 650, unit: 'mg', strengthRaw: '650 mg', unclear: false, fromReference: false }],
      warnings: [WARNING_NO_FREQUENCY],
    });
    expect(d.lines[0].reference?.productName).toBe('Dolo 650');
  });

  it('a printed prescription with 1-0-1 dosing, an unclear digit and a brand-only line', () => {
    const d = parsePages([{ page: 2, text: PRESCRIPTION }]);
    expect(d).toMatchObject({ kind: 'prescription', clinicalDate: '2026-10-28', prescriberName: 'Dr. Kavita Rao' });
    expect(d.lines.map((l) => [l.page, l.productName, l.dosesPerDay, l.instruction, l.doseRaw])).toEqual([
      [2, 'Amlodipine 10 mg', 1, '1 tablet, morning', '1-0-0'],
      [2, 'Metformin 500 mg', 2, '1 tablet, twice a day', '1-0-1'],
      [2, 'Aspirin 7? mg', 1, '1 tablet, afternoon', '0-1-0'],
      [2, 'Telma 40', 1, '1 tablet, morning', '1-0-0'],
    ]);
    expect(d.lines[2].ingredients).toEqual([{ name: 'aspirin', nameRaw: 'Aspirin', strength: null, unit: 'mg', strengthRaw: '7? mg', unclear: true, fromReference: false }]);
    expect(d.lines[3].ingredients[0]).toMatchObject({ name: 'telmisartan', strength: 40, fromReference: true, strengthRaw: null });
    expect(d.lines[3].warnings).toContain(WARNING_FROM_REFERENCE('Telma 40'));
  });

  it('a lab report header: kind, date and doctor, no medicine lines', () => {
    expect(parsePages([{ page: 1, text: LAB }])).toMatchObject({ kind: 'lab_report', clinicalDate: '2026-11-12', prescriberName: 'Dr. Kavita Rao', lines: [] });
  });

  it('lines keep the page they came from, across pages', () => {
    const d = parsePages([{ page: 1, text: 'Rx\nTab. Amlodipine 10 mg 1-0-0' }, { page: 2, text: 'Tab. Rosuvastatin 10 mg 0-0-1' }]);
    expect(d.lines.map((l) => [l.page, l.productName])).toEqual([[1, 'Amlodipine 10 mg'], [2, 'Rosuvastatin 10 mg']]);
  });

  it('unknown names, missing strengths and lines that are not medicines', () => {
    const d = parsePages([{ page: 1, text: 'Rx\nTab. Unknownol 0-1-0\nTab. Zyloric 100 mg OD\nReview after 4 weeks\nTab. Aspirin 0-1-0' }]);
    expect(d.lines.map((l) => [l.productName, l.ingredients.map((i) => [i.name, i.strength, i.unit, i.strengthRaw])])).toEqual([
      ['Unknownol', []],
      ['Zyloric 100 mg', [['zyloric', 100, 'mg', '100 mg']]],
      ['Aspirin', [['aspirin', null, null, null]]],
    ]);
    expect(parsePages([{ page: 1, text: '' }]).lines).toEqual([]);
    expect(parsePages([{ page: 1, text: 'Keep out of reach of children\nStore below 25 C' }]).lines).toEqual([]);
  });

  it('a pack read through OCR, with the brand missed and "|" for "I"', () => {
    const d = parsePages([{ page: 1, text: 'Ibuprofen and Paracetamol Tablets I.P.\nEach uncoated tablet contains:\nIbuprofen |.P. 400 mg\nParacetamol |.P. 325 mg' }]);
    expect(d.lines[0]).toMatchObject({ productName: 'Ibuprofen And Paracetamol Tablets IP', reference: null });
    expect(d.lines[0].ingredients.map((i) => [i.name, i.strength])).toEqual([['ibuprofen', 400], ['paracetamol', 325]]);
    expect(parsePages([{ page: 1, text: 'COMBIFLAM\nstrip of 20 tablets' }]).lines[0].warnings[0]).toContain('drug reference for Combiflam');
  });

  it('dates: impossible ones are flagged; manufacturing and expiry dates are ignored', () => {
    expect(parsePages([{ page: 1, text: 'Lab report: CBC\nDate: 31/02/2026' }])).toMatchObject({ clinicalDate: null, dateUnclear: true, dateRaw: '31/02/2026' });
    expect(parsePages([{ page: 1, text: PACK }])).toMatchObject({ clinicalDate: null, dateUnclear: false, dateRaw: null });
  });

  it('edge cases of names, forms and doses', () => {
    expect(findIngredients('Paracetamol IP Caffeine 50 mg').map((i) => i.name)).toEqual(['caffeine']);
    expect(findIngredients('Metformin H. 500 mg').map((i) => i.name)).toEqual(['metformin']);
    expect(findIngredients('Paracetamol Tablets IP 650 mg').map((i) => i.name)).toEqual(['paracetamol']);
    const d = parsePages([{ page: 1, text: [
      'Rx', '', 'Tab. Glimepiride 1 mg 2-0-1', 'Syp. Paracetamol 250 mg TDS', 'Inj. Insulin 10 IU OD', 'Telma 40 1-0-0', 'Tab. 1-0-1', 'Tab. Amlodipine 10 mg 0-0-0',
    ].join('\n') }]);
    expect(d.lines.map((l) => [l.productName, l.form, l.dosesPerDay, l.instruction, l.doseRaw])).toEqual([
      ['Glimepiride 1 mg', 'tablet', 3, '2 morning, 1 night', '2-0-1'],
      ['Paracetamol 250 mg', 'syrup', 3, '1 dose, three times a day', 'TDS'],
      ['Insulin 10 IU', 'other', 1, '1 dose, once a day', 'OD'],
      ['Telma 40', 'tablet', 1, '1 tablet, morning', '1-0-0'],
      ['Amlodipine 10 mg', 'tablet', null, '', '0-0-0'],
    ]);
    expect(parsePages([{ page: 1, text: 'Paracetamol 500 mg\nstrip of ten' }]).lines[0]).toMatchObject({ form: 'other', productName: 'Paracetamol 500 mg' });
    // A prescription line without 'Tab.' and without a form word is taken as a tablet.
    expect(parsePages([{ page: 1, text: 'Rx\nGlimepiride 1 mg 1-0-0' }]).lines[0]).toMatchObject({ productName: 'Glimepiride 1 mg', form: 'tablet' });
  });

  it('strength and ingredient helpers', () => {
    expect(findStrengths('650 mg, 7? mg, ?? mg, 250 mg/5 ml, 60000 IU').map((s) => [s.raw, s.value, s.unit, s.unclear])).toEqual([
      ['650 mg', 650, 'mg', false], ['7? mg', null, 'mg', true], ['?? mg', null, 'mg', true], ['5 ml', 5, 'ml', false], ['60000 IU', 60000, 'IU', false],
    ]);
    expect(findIngredients('Paracetamol IP 650 mg + Caffeine 50 mg + Paracetamol 100 mg').map((i) => i.name)).toEqual(['paracetamol', 'caffeine']);
    expect(titleCase('ZYLORIC 100 MG I.P.')).toBe('Zyloric 100 mg IP');
    expect(recognisedSomething(parsePages([{ page: 1, text: PACK }]).lines)).toBe(true);
    expect(recognisedSomething(parsePages([{ page: 1, text: 'Rx\nTab. Unknownol 5 mg' }]).lines)).toBe(false);
  });
});

describe('OCR output mapping', () => {
  it('Tesseract blocks → lines with 0-1 confidence and boxes', () => {
    const lines = linesFromTesseract([{ paragraphs: [{ lines: [
      { text: 'DOLO 650\n', confidence: 91, words: [{ text: 'DOLO', confidence: 95, bbox: { x0: 10, y0: 5, x1: 60, y1: 25 } }, { text: '650', confidence: 87, bbox: { x0: 70, y0: 5, x1: 100, y1: 25 } }] },
      { text: '   ', confidence: 10, words: [] },
    ] }] }]);
    expect(lines).toEqual([{ text: 'DOLO 650', confidence: 0.91, words: [
      { text: 'DOLO', confidence: 0.95, box: { x: 10, y: 5, width: 50, height: 20 } },
      { text: '650', confidence: 0.87, box: { x: 70, y: 5, width: 30, height: 20 } },
    ] }]);
    expect(linesFromTesseract(null)).toEqual([]);
  });

  it('PaddleOCR items → lines in reading order', () => {
    const box = (text: string, x: number, y: number, score = 0.9) => ({ text, score, poly: [[x, y], [x + 40, y], [x + 40, y + 20], [x, y + 20]] });
    const lines = linesFromPaddle([box('650', 80, 12, 0.8), box('Paracetamol', 10, 60), box('DOLO', 10, 10, 0.99), box(' ', 0, 0)]);
    expect(lines.map((l) => [l.text, l.confidence])).toEqual([['DOLO 650', 0.8], ['Paracetamol', 0.9]]);
    expect(lines[0].words[0].box).toEqual({ x: 10, y: 10, width: 40, height: 20 });
  });
});

describe('PDF with pdf.js (real files)', () => {
  it('reads every page of a text PDF', async () => {
    const pdf = await readPdfPages(await fixture('text-two-pages.pdf', 'application/pdf'), legacyPdf);
    expect(pdf.pageCount).toBe(2);
    expect(pdf.pages[0]).toContain('Tab. Telmisartan 80 mg 1-0-0');
    expect(pdf.pages[1]).toContain('Tab. Aspirin 0-1-0');
  });

  it('a scanned PDF has pages but no text', async () => {
    const pdf = await readPdfPages(await fixture('scanned-five-pages.pdf', 'application/pdf'), legacyPdf);
    expect(pdf.pageCount).toBe(5);
    expect(pdf.pages.join('').trim()).toBe('');
  });

  it('a password-protected PDF is reported as locked_pdf, never read', async () => {
    await expect(readPdfPages(await fixture('locked.pdf', 'application/pdf'), legacyPdf)).rejects.toMatchObject({ code: 'locked_pdf' });
  });

  it('groups text items into lines', () => {
    const item = (str: string, x: number, y: number, width = 10) => ({ str, transform: [1, 0, 0, 1, x, y], width });
    expect(textItemsToLines([item('Tab.', 10, 100, 20), item('Amlodipine', 35, 101, 60), item('second', 10, 80), item(' ', 50, 80)])).toEqual(['Tab. Amlodipine', 'second']);
  });
});

function engine(name: 'tesseract' | 'paddle', page: OcrPage | Error): OcrEngineV2 {
  return {
    name,
    recognize: vi.fn(async () => {
      if (page instanceof Error) throw page;
      return page;
    }),
    dispose: async () => undefined,
  };
}

const ocrPage = (text: string, confidence = 0.92): OcrPage => ({
  text, confidence, lines: text.split('\n').map((t) => ({ text: t, confidence, words: [] })),
});

const cloudAnswer: ExtractionCandidate = {
  documentId: 'x', kind: 'other', title: '', clinicalDate: null, prescriberName: null, facility: null, patientNameRead: null,
  patientMatch: 'not_found', tags: [], testNames: [], fields: [], pageCount: null, pagesRead: null,
  engine: 'cloud', rawText: 'DOLO 650', needsCloud: false,
  lines: [{ lineIndex: 0, productName: 'Dolo 650', ingredients: [{ name: 'Paracetamol', strength: 650, unit: 'mg' }], form: 'tablet', dosesPerDay: null, instruction: '', warnings: [] }],
};

function deps(over: Partial<ReadingDepsV2> = {}): ReadingDepsV2 & { cloud: ReturnType<typeof vi.fn>; renderPdfPage: ReturnType<typeof vi.fn> } {
  return {
    pdfPages: (file: Blob) => readPdfPages(file, legacyPdf),
    renderPdfPage: vi.fn(async (_file: Blob, page: number) => new Blob([`page ${page}`], { type: 'image/png' })),
    engines: async () => [engine('tesseract', ocrPage(PACK))],
    cloud: vi.fn(async () => cloudAnswer as never),
    ...over,
  } as never;
}

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' });

describe('readFile', () => {
  it('a text PDF is read from its text layer, every page, without OCR', async () => {
    const ocr = engine('tesseract', ocrPage('unused'));
    const d = deps({ engines: async () => [ocr] });
    const result = await readFile(await fixture('text-two-pages.pdf', 'application/pdf'), { allowCloud: false }, d);
    expect(result).toMatchObject({ engine: 'pdf_text', source: 'pdf_text', pageCount: 2, pagesRead: 2, ocrLines: [] });
    expect(result.parsed.lines.map((l) => [l.page, l.productName])).toEqual([
      [1, 'Amlodipine 10 mg'], [1, 'Telmisartan 80 mg'], [2, 'Rosuvastatin 10 mg'], [2, 'Aspirin'],
    ]);
    expect(ocr.recognize).not.toHaveBeenCalled();
    expect(d.renderPdfPage).not.toHaveBeenCalled();
  });

  it('a scanned PDF: OCR on the first four pages, and says so', async () => {
    const ocr = engine('tesseract', ocrPage('Lakeside Diagnostics\nLab report: Lipid profile\nPatient: Ramesh Iyer\nDate: 12/11/2026'));
    const d = deps({ engines: async () => [ocr] });
    const result = await readFile(await fixture('scanned-five-pages.pdf', 'application/pdf'), { allowCloud: false }, d);
    expect(MAX_OCR_PAGES).toBe(4);
    expect(result).toMatchObject({ engine: 'on_device', source: 'ocr', pageCount: 5, pagesRead: 4 });
    expect(d.renderPdfPage.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4]);
    expect(ocr.recognize).toHaveBeenCalledTimes(4);
    expect(new Set(result.ocrLines.map((l) => l.page))).toEqual(new Set([1, 2, 3, 4]));
    expect(result.parsed.kind).toBe('lab_report');
  });

  it('a photo is read with OCR; a failing engine falls back to the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = engine('paddle', ocrPage(PACK, 0.97));
    const result = await readFile(photo, { allowCloud: false }, deps({ engines: async () => [engine('tesseract', new Error('model failed')), second] }));
    expect(result).toMatchObject({ engine: 'on_device', source: 'ocr', pageCount: 1, pagesRead: 1, confidence: 0.97 });
    expect(result.parsed.lines[0].productName).toBe('Dolo 650');
    expect(result.ocrLines[0]).toMatchObject({ page: 1, text: 'DOLO 650' });
    warn.mockRestore();
  });

  it('a poor read without consent is refused, and nothing is sent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const engines of [[engine('tesseract', ocrPage('smudge xx', 0.3))], [engine('tesseract', new Error('offline'))], []]) {
      const d = deps({ engines: async () => engines });
      await expect(readFile(photo, { allowCloud: false }, d)).rejects.toMatchObject({ code: 'cloud_consent_required' });
      expect(d.cloud).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it('with consent the cloud reads the first image, and its answer is parsed', async () => {
    const d = deps({ engines: async () => [engine('tesseract', ocrPage('unreadable', 0.2))] });
    const result = await readFile(photo, { allowCloud: true }, d);
    expect(d.cloud).toHaveBeenCalledWith(photo);
    expect(result).toMatchObject({ engine: 'cloud', source: 'cloud', ocrLines: [] });
    expect(result.parsed.lines[0]).toMatchObject({ productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 650, strengthRaw: '650 mg' }] });
    // A scanned PDF sends its first page as an image.
    const scanned = deps({ engines: async () => [engine('tesseract', ocrPage('', 0))] });
    await readFile(await fixture('scanned-five-pages.pdf', 'application/pdf'), { allowCloud: true }, scanned);
    expect(scanned.cloud).toHaveBeenCalledWith(await scanned.renderPdfPage.mock.results[0].value);
  });

  it('rejects what is not a photo or a PDF, and a locked PDF', async () => {
    await expect(readFile(new Blob(['hi'], { type: 'text/plain' }), { allowCloud: true }, deps())).rejects.toMatchObject({ code: 'unsupported_file' });
    await expect(readFile(new Blob([], { type: 'image/png' }), { allowCloud: true }, deps())).rejects.toMatchObject({ code: 'unsupported_file' });
    await expect(readFile(await fixture('locked.pdf', ''), { allowCloud: true }, deps())).rejects.toMatchObject({ code: 'locked_pdf' });
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
    expect((await readFile(png, { allowCloud: false }, deps())).source).toBe('ocr');
  });

  it('needsCloud rules', () => {
    expect(needsCloud(parsePages([{ page: 1, text: 'DOLO 650' }]), 0.95)).toBe(true);
    expect(needsCloud(parsePages([{ page: 1, text: PACK }]), 0.5)).toBe(true);
    expect(needsCloud(parsePages([{ page: 1, text: 'Some long text that names no medicine at all here' }]), 0.95)).toBe(true);
    expect(needsCloud(parsePages([{ page: 1, text: LAB }]), 0.95)).toBe(false);
    expect(needsCloud(parsePages([{ page: 1, text: PACK }]), 0.95)).toBe(false);
  });

  it('cloud answers of each document type', () => {
    for (const kind of ['prescription', 'lab_report', 'test', 'discharge_summary', 'other'] as const) {
      expect(parsedFromCloud({ ...(cloudAnswer as unknown as Record<string, unknown>), documentType: kind, documentDate: '2026-11-12' } as never).kind).toBe(kind);
    }
  });

  it('cloud errors become v2 errors; a 503 means the cloud reader is not set up', () => {
    expect(toV2Error(new V1ServiceError('network', 'The cloud reader did not answer (503). Please try again.'))).toMatchObject({ code: 'not_configured' });
    const network = toV2Error(new V1ServiceError('network', 'offline'));
    expect(network).toBeInstanceOf(ServiceError);
    expect(network).toMatchObject({ code: 'network' });
    const other = new Error('x');
    expect(toV2Error(other)).toBe(other);
  });
});
