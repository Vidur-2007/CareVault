// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IDS, samplePrescriptionLines } from '../../contract/legacy/fixtures/sampleCase';
import { ServiceError, type ExtractionCandidate } from '../../contract/legacy/types';
import { SAMPLE_DOCUMENT_FILES } from '../createRealServices';
import { crossCheck, DRUG_TABLE, findProductsInText, isKnownIngredient, lookupProduct, normalizeProductName } from '../drugref/lookup';
import { candidateFromCloud, extractInCloud, MAX_IMAGE_BYTES } from './cloud';
import type { OcrEngine } from './ocr/engine';
import { linesFromItems } from './ocr/paddle';
import {
  findDate,
  findDocumentType,
  findDose,
  findForm,
  findIngredients,
  findPrescriber,
  findStrengths,
  parseText,
  WARNING_NO_FREQUENCY,
} from './parse';
import { extractPdfText, type PdfLoader } from './pdfText';
import { needsCloud } from './quality';
import { readDocument, type ReadingDeps } from './read';

const PACK_LABEL = `DOLO 650
Paracetamol Tablets IP 650 mg
Each uncoated tablet contains:
Paracetamol IP 650 mg
Dosage: As directed by the physician.
Store in a cool dry place. Keep out of reach of children.
Mfg. Lic. No. KTK/25/000  B. No. DOB0000
Mfd. 06/2026  Exp. 05/2029
Manufactured by: MICRO LABS LIMITED`;

const PRINTED_PRESCRIPTION = `Sunrise Heart and Diabetes Clinic
Dr. Kavita Rao MD, DM            Date: 28/10/2026
Patient: Ramesh Iyer  Age: 71 years
Rx
1. Tab. Amlodipine 10 mg   1-0-0   30 days
2. Tab. Telma 40           1-0-1   30 days
3. Cap. Pan-D              1-0-0 before food
4. Tab. Zyloric 100 mg     once daily
Review after 4 weeks.`;

const LAB_REPORT = `Lakeside Diagnostics
Lab report: Lipid profile
Patient: Ramesh Iyer   DOB: 02/03/1955
Date: 12 Nov 2026      Referred by: Dr. Kavita Rao
Total cholesterol 186 mg/dL  Reference range: below 200 mg/dL
LDL cholesterol 112 mg/dL`;

describe('drug reference', () => {
  it('has the sample case, about forty common products and five paracetamol combinations', () => {
    expect(DRUG_TABLE.length).toBeGreaterThanOrEqual(48);
    for (const name of ['Dolo 650', 'Crocin Advance 500', 'Amlodipine 5 mg', 'Rosuvastatin 10 mg', 'Metformin 500 mg', 'Pantoprazole 40 mg']) {
      expect(lookupProduct(name)?.score).toBe(1);
    }
    const combinations = DRUG_TABLE.filter((e) => e.ingredients.length > 1 && e.ingredients.some((i) => i.name === 'paracetamol'));
    expect(combinations.length).toBeGreaterThanOrEqual(5);
    expect(new Set(DRUG_TABLE.map((e) => normalizeProductName(e.productName))).size).toBe(DRUG_TABLE.length);
    for (const entry of DRUG_TABLE) {
      expect(entry.source).toBeTruthy();
      expect(entry.ingredients.length).toBeGreaterThan(0);
      for (const i of entry.ingredients) expect(i.strength).toBeGreaterThan(0);
    }
  });

  it('matches names whatever the case and punctuation, and by alias', () => {
    expect(lookupProduct('dolo-650')?.entry.productName).toBe('Dolo 650');
    expect(lookupProduct('DOLO  650 ')).toMatchObject({ score: 1 });
    expect(lookupProduct('Crocin Advance')?.entry.productName).toBe('Crocin Advance 500');
    expect(lookupProduct('PAN-D')?.entry.productName).toBe('Pan D');
    expect(lookupProduct('Cardivas 6.25')?.entry.ingredients).toEqual([{ name: 'carvedilol', strength: 6.25, unit: 'mg' }]);
  });

  it('finds near matches from OCR, but never across different numbers', () => {
    const near = lookupProduct('Rosuvaz 10');
    expect(near?.entry.productName).toBe('Rosuvas 10');
    expect(near!.score).toBeLessThan(1);
    expect(near!.score).toBeGreaterThanOrEqual(0.8);
    expect(lookupProduct('Combifiam')?.entry.productName).toBe('Combiflam');
    expect(lookupProduct('Rosuvas 40')).toBeNull();
    expect(lookupProduct('Rosuvas')).toBeNull();
    expect(lookupProduct('Aspirin 75')).toBeNull();
    expect(lookupProduct('  ')).toBeNull();
  });

  it('finds product names in text, preferring the longer name', () => {
    expect(findProductsInText('COMBIFLAM PLUS\nstrip of 10').map((m) => [m.entry.productName, m.lineIndex])).toEqual([['Combiflam Plus', 0]]);
    expect(findProductsInText('Tab. Telma 40 1-0-0')[0].entry.productName).toBe('Telma 40');
    expect(findProductsInText('D0LO 650 tablets')[0]).toMatchObject({ entry: { productName: 'Dolo 650' } });
    expect(findProductsInText('Sunrise Heart and Diabetes Clinic\n\nReview after 3 months')).toEqual([]);
  });

  it('knows ingredients through synonyms and salts', () => {
    expect(isKnownIngredient('Acetaminophen')).toBe(true);
    expect(isKnownIngredient('Amlodipine Besylate IP')).toBe(true);
    expect(isKnownIngredient('Allopurinol')).toBe(false);
  });

  it('cross-checks without correcting', () => {
    expect(crossCheck('Dolo 650', [{ name: 'paracetamol', strength: 650, unit: 'mg' }])).toEqual([]);
    expect(crossCheck('Dolo 650', [{ name: 'paracetamol', strength: 0.65, unit: 'g' }])).toEqual([]);
    expect(crossCheck('Dolo 650', [])).toEqual([]);
    expect(crossCheck('Dolo 650', [{ name: 'paracetamol', strength: 500, unit: 'mg' }])).toEqual([
      'What was read does not match the drug reference for Dolo 650 (paracetamol 650 mg). Please check against the pack.',
    ]);
    expect(crossCheck('Amlodipine 2.5 mg', [{ name: 'amlodipine', strength: 2.5, unit: 'mg' }])).toEqual([]);
    expect(crossCheck('Zyloric 100', [{ name: 'allopurinol', strength: 100, unit: 'mg' }])).toHaveLength(1);
    expect(crossCheck('Mystery', [])).toHaveLength(1);
  });
});

describe('parse helpers', () => {
  it('reads strengths, and leaves concentrations and lab values alone', () => {
    expect(findStrengths('Paracetamol 650 mg, Caffeine 50mg, D3 60000 IU, 0.25 mcg, 5 ml, 1 gm').map((s) => [s.value, s.unit])).toEqual([
      [650, 'mg'], [50, 'mg'], [60000, 'IU'], [0.25, 'mcg'], [5, 'ml'], [1, 'g'],
    ]);
    expect(findStrengths('Total cholesterol 186 mg/dL, 250 mg/5 ml, 30 days, 160 ms')).toEqual([expect.objectContaining({ value: 5, unit: 'ml' })]);
  });

  it('reads composition lines', () => {
    expect(findIngredients('Each uncoated tablet contains: Paracetamol IP 650 mg')).toEqual([{ name: 'paracetamol', strength: 650, unit: 'mg' }]);
    expect(findIngredients('Each film coated tablet contains Ibuprofen I.P. 400 mg, Paracetamol I.P. 325 mg')).toEqual([
      { name: 'ibuprofen', strength: 400, unit: 'mg' },
      { name: 'paracetamol', strength: 325, unit: 'mg' },
    ]);
    expect(findIngredients('Pantoprazole Sodium IP equivalent to Pantoprazole 40 mg and Domperidone IP 30 mg')).toEqual([
      { name: 'pantoprazole', strength: 40, unit: 'mg' },
      { name: 'domperidone', strength: 30, unit: 'mg' },
    ]);
    expect(findIngredients('Amlodipine Besylate IP eq. to Amlodipine 5 mg')).toEqual([{ name: 'amlodipine', strength: 5, unit: 'mg' }]);
    expect(findIngredients('Acetaminophen USP 500 mg + Paracetamol 125 mg')).toEqual([{ name: 'paracetamol', strength: 500, unit: 'mg' }]);
    expect(findIngredients('Net content 10 mg')).toEqual([]);
    expect(findIngredients('Take 5 ml; 650 mg')).toEqual([]);
  });

  it('reads the form', () => {
    expect(findForm('Tab. Amlodipine')).toBe('tablet');
    expect(findForm('Hard gelatin capsules')).toBe('capsule');
    expect(findForm('Paracetamol oral suspension')).toBe('syrup');
    expect(findForm('Apply twice')).toBeNull();
  });

  it('reads dose patterns', () => {
    expect(findDose('1-0-0')).toEqual({ dosesPerDay: 1, when: 'morning' });
    expect(findDose('0-1-0')).toEqual({ dosesPerDay: 1, when: 'afternoon' });
    expect(findDose('0 - 0 - 1')).toEqual({ dosesPerDay: 1, when: 'night' });
    expect(findDose('1-0-1')).toEqual({ dosesPerDay: 2, when: 'twice a day' });
    expect(findDose('1-1-1 after food')).toEqual({ dosesPerDay: 3, when: 'three times a day, after food' });
    expect(findDose('2-0-1')).toEqual({ dosesPerDay: 3, when: '2 morning, 1 night' });
    expect(findDose('½-0-½')).toEqual({ dosesPerDay: 1, when: 'twice a day' });
    expect(findDose('0-0-0')).toEqual({ dosesPerDay: null, when: '' });
    expect(findDose('BD')).toEqual({ dosesPerDay: 2, when: 'twice a day' });
    expect(findDose('TDS x 5 days')).toEqual({ dosesPerDay: 3, when: 'three times a day' });
    expect(findDose('OD before breakfast')).toEqual({ dosesPerDay: 1, when: 'once a day, before breakfast' });
    expect(findDose('twice a day')).toEqual({ dosesPerDay: 2, when: 'twice a day' });
    expect(findDose('QID')).toEqual({ dosesPerDay: 4, when: 'four times a day' });
    expect(findDose('HS')).toEqual({ dosesPerDay: 1, when: 'night' });
    expect(findDose('as directed, before food')).toEqual({ dosesPerDay: null, when: 'before food' });
    expect(findDose('phone 080-555-0142, 2026-10-28')).toEqual({ dosesPerDay: null, when: '' });
  });

  it('reads dates day first, and skips manufacturing, expiry and birth dates', () => {
    expect(findDate('Date: 28/10/2026')).toBe('2026-10-28');
    expect(findDate('Date: 5-8-26')).toBe('2026-08-05');
    expect(findDate('Dated 28 Oct 2026')).toBe('2026-10-28');
    expect(findDate('5th August, 2026')).toBe('2026-08-05');
    expect(findDate('November 12, 2026')).toBe('2026-11-12');
    expect(findDate('2026-07-14')).toBe('2026-07-14');
    expect(findDate('Mfd. 06/2026 Exp. 05/2029\nDOB: 02/03/1955')).toBeNull();
    expect(findDate('31/02/2026')).toBeNull();
    expect(findDate('12 Foo 2026\n45/13/2026\n2026-13-40\nFoo 12, 2026')).toBeNull();
    expect(findDate('no date here')).toBeNull();
  });

  it('reads the prescriber', () => {
    expect(findPrescriber('Dr. Kavita Rao MD, DM   Date: 28/10/2026')).toBe('Dr. Kavita Rao');
    expect(findPrescriber('Referred by: Dr Suresh Menon')).toBe('Dr. Suresh Menon');
    expect(findPrescriber('Referred by the clinic\nDr. A. K. Sharma,')).toBe('Dr. A. K. Sharma');
    expect(findPrescriber('Dr. MBBS')).toBeNull();
    expect(findPrescriber('Dolo 650')).toBeNull();
  });

  it('classifies documents', () => {
    expect(findDocumentType(PRINTED_PRESCRIPTION)).toBe('prescription');
    expect(findDocumentType(LAB_REPORT)).toBe('lab_report');
    expect(findDocumentType('ECG report\nImpression: sinus rhythm')).toBe('test');
    expect(findDocumentType('ECG and lipid profile results')).toBe('lab_report');
    expect(findDocumentType('Discharge summary\nRx on discharge')).toBe('discharge_summary');
    expect(findDocumentType(PACK_LABEL)).toBe('other');
  });
});

describe('parseText', () => {
  it('a pack label with a composition line', () => {
    const candidate = parseText(PACK_LABEL);
    expect(candidate).toMatchObject({ documentType: 'other', documentDate: null, prescriberName: null, engine: 'on_device', rawText: PACK_LABEL, needsCloud: false });
    expect(candidate.lines).toEqual([
      {
        productName: 'Dolo 650',
        ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: null,
        instruction: '',
        warnings: [WARNING_NO_FREQUENCY],
      },
    ]);
  });

  it('a pack of a product the reference does not know keeps what is printed', () => {
    const [line] = parseText('ZYLORIC 100\nAllopurinol Tablets IP\nEach tablet contains Allopurinol IP 100 mg').lines;
    expect(line).toMatchObject({ productName: 'Zyloric 100', ingredients: [{ name: 'allopurinol', strength: 100, unit: 'mg' }], form: 'tablet' });
  });

  it('a pack whose composition was not read is filled from the reference, and says so', () => {
    const [line] = parseText('COMBIFLAM\nstrip of 20 tablets\nSanofi').lines;
    expect(line.ingredients).toEqual([{ name: 'ibuprofen', strength: 400, unit: 'mg' }, { name: 'paracetamol', strength: 325, unit: 'mg' }]);
    expect(line.warnings[0]).toContain('filled in from the drug reference for Combiflam');
    const known = parseText('Paracetamol Tablets IP 500 mg\nstrip of ten').lines[0];
    expect(known).toMatchObject({ productName: 'Paracetamol Tablets IP 500 mg', ingredients: [{ name: 'paracetamol', strength: 500, unit: 'mg' }] });
  });

  it('a real Tesseract.js read of a pack, with "I.P." misread as "|.P." and the brand missed', () => {
    // Output of Tesseract.js on a clean, photographed Combiflam label (audit, 2026-11-19).
    const ocr = 'Ibuprofen and Paracetamol Tablets I.P.\nEach uncoated tablet contains:\n\nIbuprofen |.P. 400 mg\n\nParacetamol |.P. 325 mg\n\nDosage: As directed by the physician.\n\nStore below 30 C. Keep out of reach of children.\nMfd. 03/2026 Exp. 02/2029 B. No. TESTO1\n';
    const candidate = parseText(ocr);
    expect(candidate.rawText).toBe(ocr);
    expect(candidate.lines).toEqual([
      {
        productName: 'Ibuprofen And Paracetamol Tablets IP',
        ingredients: [{ name: 'ibuprofen', strength: 400, unit: 'mg' }, { name: 'paracetamol', strength: 325, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: null,
        instruction: '',
        warnings: [WARNING_NO_FREQUENCY],
      },
    ]);
    expect(needsCloud(candidate, 0.9)).toBe(false);
    expect(findIngredients('Metformin H. 500 mg')).toEqual([{ name: 'metformin', strength: 500, unit: 'mg' }]);
  });

  it('text with nothing recognisable gives no lines', () => {
    expect(parseText('Keep out of reach of children\nStore below 25 C').lines).toEqual([]);
    expect(parseText('').lines).toEqual([]);
  });

  it('a printed prescription with 1-0-1 dosing', () => {
    const candidate = parseText(PRINTED_PRESCRIPTION);
    expect(candidate).toMatchObject({ documentType: 'prescription', documentDate: '2026-10-28', prescriberName: 'Dr. Kavita Rao' });
    expect(candidate.lines).toEqual([
      { productName: 'Amlodipine 10 mg', ingredients: [{ name: 'amlodipine', strength: 10, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] },
      {
        productName: 'Telma 40',
        ingredients: [{ name: 'telmisartan', strength: 40, unit: 'mg' }],
        form: 'tablet',
        dosesPerDay: 2,
        instruction: '1 tablet, twice a day',
        warnings: ['The ingredients were not printed. They were filled in from the drug reference for Telma 40. Please check.'],
      },
      {
        productName: 'Pan D',
        ingredients: [{ name: 'pantoprazole', strength: 40, unit: 'mg' }, { name: 'domperidone', strength: 30, unit: 'mg' }],
        form: 'capsule',
        dosesPerDay: 1,
        instruction: '1 capsule, morning, before food',
        warnings: [expect.stringContaining('drug reference for Pan D')],
      },
      { productName: 'Zyloric 100 mg', ingredients: [{ name: 'zyloric', strength: 100, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, once a day', warnings: [] },
    ]);
  });

  it('prescription lines without a frequency, a mixed dose, and a syrup', () => {
    const lines = parseText('Rx\nTab. Metformin 500 mg\nTab. Glimepiride 1 mg 2-0-1\nSyp. Paracetamol 5 ml TDS\nTab. Unknownol\nTake rest').lines;
    expect(lines.map((l) => [l.productName, l.dosesPerDay, l.instruction, l.warnings.length])).toEqual([
      ['Metformin 500 mg', null, '', 1],
      ['Glimepiride 1 mg', 3, '2 morning, 1 night', 0],
      ['Paracetamol 5 ml', 3, '1 dose, three times a day', 0],
    ]);
    expect(lines[0].warnings).toEqual([WARNING_NO_FREQUENCY]);
  });

  it('a lab report header: type, date and referring doctor, no medicine lines', () => {
    expect(parseText(LAB_REPORT)).toMatchObject({ documentType: 'lab_report', documentDate: '2026-11-12', prescriberName: 'Dr. Kavita Rao', lines: [] });
  });

  it('is deterministic', () => {
    expect(parseText(PRINTED_PRESCRIPTION)).toEqual(parseText(PRINTED_PRESCRIPTION));
  });
});

describe('quality', () => {
  const candidate = (text: string) => parseText(text);
  it('accepts a clear read', () => {
    expect(needsCloud(candidate(PACK_LABEL), 0.9)).toBe(false);
    expect(needsCloud(candidate(PRINTED_PRESCRIPTION), 1)).toBe(false);
    expect(needsCloud(candidate(LAB_REPORT), 1)).toBe(false);
  });
  it('asks for the cloud when the text is very short, confidence is low, or no medicine was recognised', () => {
    expect(needsCloud(candidate('DOLO 650'), 0.95)).toBe(true);
    expect(needsCloud(candidate(PACK_LABEL), 0.4)).toBe(true);
    expect(needsCloud(candidate('Some pack with a long unreadable name\nxxxx yyyy zzzz'), 0.9)).toBe(true);
    expect(needsCloud(candidate('Rx\nTab. Unreadablex 10 mg 1-0-0 for thirty days'), 0.9)).toBe(true);
  });
});

describe('cloud client', () => {
  const good = {
    documentType: 'prescription',
    documentDate: '2026-10-28',
    prescriberName: ' Dr. Kavita Rao ',
    rawText: 'raw',
    lines: [
      { productName: 'Amlodipine 10 mg', ingredients: [{ name: 'Amlodipine Besylate', strength: 10, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: ' 1 tablet, morning ', warnings: [] },
    ],
  };
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });

  it('posts the image as base64 and returns a validated candidate', async () => {
    const fetcher = ok(good);
    const candidate = await extractInCloud(image, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/extract');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ imageBase64: '/9j/AQID', mimeType: 'image/jpeg' });
    // With a page, the page is sent too.
    await extractInCloud(image, fetcher as unknown as typeof fetch, 2);
    expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ imageBase64: '/9j/AQID', mimeType: 'image/jpeg', page: 2 });
    expect(candidate).toEqual({
      documentType: 'prescription',
      documentDate: '2026-10-28',
      prescriberName: 'Dr. Kavita Rao',
      lines: [{ productName: 'Amlodipine 10 mg', ingredients: [{ name: 'amlodipine', strength: 10, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction: '1 tablet, morning', warnings: [] }],
      engine: 'cloud',
      rawText: 'raw',
      needsCloud: false,
    });
  });

  it('drops what fails validation and reports it as a warning', () => {
    const candidate = candidateFromCloud({
      documentType: 'recipe',
      documentDate: 'yesterday',
      prescriberName: 7,
      lines: [
        { productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 'lots', unit: 'mg' }, { name: 'caffeine', strength: 50, unit: 'mg' }], form: 'pill', dosesPerDay: -1, warnings: ['seen', 3] },
        { productName: '   ' },
        'not a line',
        { productName: 'Crocin', dosesPerDay: null, form: null },
      ],
    });
    expect(candidate).toMatchObject({ documentType: 'other', documentDate: null, prescriberName: null, rawText: '', engine: 'cloud' });
    expect(candidate.lines).toHaveLength(2);
    expect(candidate.lines[0]).toMatchObject({ ingredients: [{ name: 'caffeine', strength: 50, unit: 'mg' }], form: 'other', dosesPerDay: null, instruction: '' });
    expect(candidate.lines[0].warnings).toEqual(['seen', expect.stringContaining('could not be used')]);
    expect(candidate.lines[1]).toEqual({ productName: 'Crocin', ingredients: [], form: 'other', dosesPerDay: null, instruction: '', warnings: [] });
    const onlyDroppedLines = candidateFromCloud({ lines: [{ productName: 'Dolo 650' }, null] });
    expect(onlyDroppedLines.lines[0].warnings).toEqual([expect.stringContaining('could not be used')]);
    expect(candidateFromCloud({}).lines).toEqual([]);
    expect(candidateFromCloud({ documentDate: '2026-13-45' }).documentDate).toBeNull();
    expect(() => candidateFromCloud('nope')).toThrow(ServiceError);
    expect(() => candidateFromCloud({ lines: 'none' })).toThrow(ServiceError);
  });

  it('maps failures to ServiceError codes', async () => {
    const code = async (fetcher: unknown, blob = image) => {
      try {
        await extractInCloud(blob, fetcher as typeof fetch);
      } catch (error) {
        return (error as ServiceError).code;
      }
      return 'resolved';
    };
    expect(await code(async () => { throw new TypeError('offline'); })).toBe('network');
    expect(await code(async () => new Response('busy', { status: 429 }))).toBe('network');
    expect(await code(async () => new Response('<html>', { status: 200 }))).toBe('unknown');
    const fetcher = vi.fn();
    expect(await code(fetcher, new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)]))).toBe('unsupported_file');
    expect(fetcher).not.toHaveBeenCalled();
    const untyped = ok(good);
    await extractInCloud(new Blob(['x']), untyped as unknown as typeof fetch);
    expect(JSON.parse((untyped.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).mimeType).toBe('image/jpeg');
  });
});

describe('PaddleOCR boxes', () => {
  it('are put in reading order', () => {
    const box = (text: string, x: number, y: number) => ({ text, score: 0.9, poly: [[x, y], [x + 50, y], [x + 50, y + 20], [x, y + 20]] });
    expect(linesFromItems([box('650', 80, 12), box('Paracetamol IP 650 mg', 10, 60), box('DOLO', 10, 10), box(' ', 0, 0)])).toBe('DOLO 650\nParacetamol IP 650 mg');
    expect(linesFromItems([])).toBe('');
  });
});

describe('readDocument', () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: 'image/jpeg' });
  const pdf = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
  const engine = (text: string, confidence = 0.92): OcrEngine => ({ name: 'tesseract', recognize: vi.fn(async () => ({ text, confidence })), dispose: async () => {} });
  const failing: OcrEngine = { name: 'paddle', recognize: vi.fn(async () => { throw new Error('model failed to load'); }), dispose: async () => {} };
  const cloudAnswer: ExtractionCandidate = {
    documentType: 'other', documentDate: null, prescriberName: null, engine: 'cloud', rawText: 'DOLO 650', needsCloud: false,
    lines: [{ productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 500, unit: 'mg' }], form: 'tablet', dosesPerDay: null, instruction: '', warnings: [] }],
  };
  const deps = (over: Partial<ReadingDeps> = {}): ReadingDeps => ({
    engines: async () => [engine(PACK_LABEL)],
    pdfText: vi.fn(async () => ''),
    renderFirstPage: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    cloud: vi.fn(async () => cloudAnswer),
    ...over,
  });
  const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);

  it('reads a photo on the device', async () => {
    const d = deps();
    const candidate = await readDocument(jpeg, { allowCloud: false }, d);
    expect(candidate).toMatchObject({ engine: 'on_device', needsCloud: false });
    expect(candidate.lines[0]).toMatchObject({ productName: 'Dolo 650', ingredients: [{ name: 'paracetamol', strength: 650, unit: 'mg' }] });
    expect(d.pdfText).not.toHaveBeenCalled();
    expect(d.cloud).not.toHaveBeenCalled();
  });

  it('reads a text PDF without OCR', async () => {
    const ocr = engine('unused');
    const d = deps({ pdfText: vi.fn(async () => PRINTED_PRESCRIPTION), engines: async () => [ocr] });
    const candidate = await readDocument(pdf, { allowCloud: false }, d);
    expect(candidate.documentType).toBe('prescription');
    expect(candidate.lines).toHaveLength(4);
    expect(ocr.recognize).not.toHaveBeenCalled();
    expect(d.renderFirstPage).not.toHaveBeenCalled();
    // The line the reference does not know carries a warning; nothing was changed.
    expect(candidate.lines[3].warnings).toEqual([expect.stringContaining('not in the drug reference')]);
    expect(candidate.lines[0].warnings).toEqual([]);
  });

  it('renders page 1 of a scanned PDF and runs OCR on it', async () => {
    const ocr = engine(PACK_LABEL);
    const d = deps({ engines: async () => [ocr] });
    const candidate = await readDocument(new Blob(['%PDF-scan']), { allowCloud: false }, d);
    expect(d.renderFirstPage).toHaveBeenCalledTimes(1);
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(candidate.lines[0].productName).toBe('Dolo 650');
  });

  it('falls back to the second engine when the first fails', async () => {
    const second = engine(PACK_LABEL);
    const candidate = await readDocument(jpeg, { allowCloud: false }, deps({ engines: async () => [failing, second] }));
    expect(second.recognize).toHaveBeenCalled();
    expect(candidate.lines).toHaveLength(1);
  });

  it('rejects with cloud_consent_required when the read is poor and the cloud is not allowed', async () => {
    const d = deps({ engines: async () => [engine('D0L0 6S0 smudged text that names nothing', 0.31)] });
    expect(await codeOf(readDocument(jpeg, { allowCloud: false }, d))).toBe('cloud_consent_required');
    expect(d.cloud).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await codeOf(readDocument(jpeg, { allowCloud: false }, deps({ engines: async () => [failing] })))).toBe('cloud_consent_required');
    expect(await codeOf(readDocument(jpeg, { allowCloud: false }, deps({ engines: async () => [] })))).toBe('cloud_consent_required');
    warn.mockRestore();
  });

  it('uses the cloud with consent, and cross-checks its answer against the reference', async () => {
    const d = deps({ engines: async () => [engine('unreadable', 0.2)] });
    const candidate = await readDocument(jpeg, { allowCloud: true }, d);
    expect(d.cloud).toHaveBeenCalledWith(jpeg);
    expect(candidate.engine).toBe('cloud');
    // The cloud said 500 mg; the reference says 650 mg. The value stays, a warning is added.
    expect(candidate.lines[0].ingredients[0].strength).toBe(500);
    expect(candidate.lines[0].warnings).toEqual([expect.stringContaining('does not match the drug reference for Dolo 650')]);
  });

  it('sends page 1 of a text PDF to the cloud when its text names no medicine', async () => {
    const d = deps({ pdfText: vi.fn(async () => 'Rx\nTab. Unreadablex 10 mg 1-0-0 for thirty days') });
    await readDocument(pdf, { allowCloud: true }, d);
    expect(d.renderFirstPage).toHaveBeenCalledTimes(1);
    expect(d.cloud).toHaveBeenCalledTimes(1);
  });

  it('rejects files that are neither a photo nor a PDF', async () => {
    expect(await codeOf(readDocument(new Blob(['hello'], { type: 'text/plain' }), { allowCloud: true }, deps()))).toBe('unsupported_file');
    expect(await codeOf(readDocument(new Blob([]), { allowCloud: true }, deps()))).toBe('unsupported_file');
    expect(await codeOf(readDocument(new Blob([], { type: 'image/png' }), { allowCloud: true }, deps()))).toBe('unsupported_file');
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
    expect((await readDocument(png, { allowCloud: false }, deps())).lines).toHaveLength(1);
  });
});

describe('the sample documents, read on the device without the cloud', () => {
  const legacy: PdfLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as ReturnType<PdfLoader>;
  const read = async (id: string) => {
    // @ts-expect-error Node built-in: the app's tsconfig has no Node types.
    const { readFileSync } = await import('node:fs');
    const bytes: Uint8Array = readFileSync(`public/sample-docs/${SAMPLE_DOCUMENT_FILES[id]}`);
    const never = vi.fn(async () => { throw new Error('must not be needed'); });
    return readDocument(new Blob([bytes as BlobPart], { type: 'application/pdf' }), { allowCloud: false }, {
      engines: never,
      pdfText: (file) => extractPdfText(file, legacy),
      renderFirstPage: never,
      cloud: never,
    });
  };
  const expectedLines = (documentId: string) =>
    samplePrescriptionLines
      .filter((l) => l.documentId === documentId)
      .map(({ productName, ingredients, form, dosesPerDay, instruction }) => ({ productName, ingredients, form, dosesPerDay, instruction, warnings: [] }));

  it.each([
    ['Rao, 5 Aug', IDS.documents.raoPrevious, '2026-08-05', 'Dr. Kavita Rao'],
    ['Rao, 28 Oct', IDS.documents.raoLatest, '2026-10-28', 'Dr. Kavita Rao'],
    ['Menon, 14 Jul', IDS.documents.menon, '2026-07-14', 'Dr. Suresh Menon'],
  ])('prescription %s gives exactly the lines of the sample case', async (_name, id, date, doctor) => {
    const candidate = await read(id);
    expect(candidate).toMatchObject({ documentType: 'prescription', documentDate: date, prescriberName: doctor, engine: 'on_device', needsCloud: false });
    expect(candidate.lines).toEqual(expectedLines(id));
  });

  it.each([
    ['Lipid profile', IDS.documents.lipidProfile, 'lab_report', '2026-11-12', 'Dr. Kavita Rao'],
    ['HbA1c report', IDS.documents.hba1c, 'lab_report', '2026-11-12', 'Dr. Suresh Menon'],
    ['ECG report', IDS.documents.ecg, 'test', '2026-09-15', 'Dr. Kavita Rao'],
  ])('report %s gives its type and date and no medicine lines', async (_name, id, type, date, doctor) => {
    expect(await read(id)).toMatchObject({ documentType: type, documentDate: date, prescriberName: doctor, lines: [], engine: 'on_device' });
  });
});
