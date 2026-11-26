// @vitest-environment node
// The OCR benchmark's scoring and table. The engines themselves run on the phone; here the
// "OCR text" is the exact text printed on each synthetic image.
import { describe, expect, it } from 'vitest';
import { BENCHMARK_SET } from '../../reading/dev/benchmarkSet';
import { buildEvidence } from '../rules/verify';
import { countOutcomes, formatBytes, scoreReading, toMarkdown, type BenchmarkRow, type ExpectedLine } from './benchmark';
import { parsePages } from './parse';
import { needsCloud } from './read';

const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { existsSync(p: string): boolean; readdirSync(p: string): string[] } } }).process.getBuiltinModule('node:fs');

/** What a perfect reader would return for each image. */
const PRINTED: Record<string, string> = {
  'pack-dolo-650.png': 'Dolo 650\nParacetamol Tablets IP 650 mg\n15 Tablets · Store below 25°C',
  'pack-telma-40.png': 'Telma 40\nTelmisartan Tablets IP 40 mg\n3 x 10 Tablets',
  'pack-crocin-advance.png': 'Crocin\nADVANCE\nParacetamol Tablets IP 500 mg\n20 Tablets',
  'pack-glycomet-glare.png': 'Glycomet 500\nMetformin Hydrochloride Tablets IP 500 mg\n10 Tablets',
  'pack-pan-40-blurred.png': 'Pan 40\nPantoprazole Gastro-resistant Tablets IP 40 mg\n15 Tablets',
  'rx-printed-clean.png': 'Dr. Kavita Rao\nMD, DM Cardiology · Sunrise Heart and Diabetes Clinic\nDate: 28/10/2026\nPatient: Ramesh Iyer, 71 years\n1. Tab. Amlodipine 10 mg 1-0-0\n2. Tab. Telmisartan 40 mg 1-0-0\n3. Tab. Rosuvastatin 10 mg 0-0-1',
  'rx-demo-smudged.png': 'Dr. Kavita Rao\nMD, DM Cardiology · Sunrise Heart and Diabetes Clinic\nDate: 13/11/2026\nPatient: Ramesh Iyer, 71 years\n1. Tab. Amlodipine 10 mg 1-0-0\n2. Tab. Telmisartan 80 mg 1-0-0\n3. Tab. Rosuvastatin 10 mg 0-0-1\n4. Tab. Aspirin 7? mg 0-1-0',
  'rx-handwriting-style.png': 'Dr. Suresh Menon\nMD Diabetology · Sunrise Heart and Diabetes Clinic\nDate: 14/07/2026\nPatient: Ramesh Iyer\nTab Metformin 500 mg 1-0-1\nafter food',
};

function score(text: string, expected: readonly ExpectedLine[], source: 'ocr' | 'pdf_text' = 'ocr') {
  const parsed = parsePages([{ page: 1, text }]);
  let n = 0;
  const evidence = buildEvidence(
    { profileId: 'p', documentId: 'd', source, parsed, ocrLines: [], patientNameRead: null, patientMatch: 'not_found' },
    { now: '2026-11-20T00:00:00Z', newId: () => `e${(n += 1)}` },
  );
  return { parsed, scores: scoreReading(expected, parsed, evidence) };
}

describe('the benchmark set', () => {
  it('every case has its image, and every image has a case', () => {
    const images = fs.readdirSync('src/core/reading/dev/benchmark').filter((f) => f.endsWith('.png')).sort();
    expect(BENCHMARK_SET.map((c) => c.file).sort()).toEqual(images);
    for (const c of BENCHMARK_SET) expect(fs.existsSync(`src/core/reading/dev/benchmark-html/${c.file.replace('.png', '.html')}`), c.file).toBe(true);
  });

  /**
   * What the parser gets wrong even from perfect text. Known and reported, not hidden: the
   * phone results will show these as "wrong, not flagged" for every engine.
   */
  const KNOWN_PARSER_LIMITS: Record<string, string[]> = {
    // The brand is printed on two lines ("Crocin" / "ADVANCE"); the product name is the first line only.
    'pack-crocin-advance.png': ['Crocin Advance medicine_name'],
  };

  it.each(BENCHMARK_SET.map((c) => [c.file, c] as const))('%s: a perfect reading is wrong only where the parser is known to be', (file, c) => {
    const { scores } = score(PRINTED[file], c.lines);
    const counts = countOutcomes(scores);
    expect(scores.filter((s) => s.outcome === 'wrong').map((s) => `${s.line} ${s.field}`)).toEqual(KNOWN_PARSER_LIMITS[file] ?? []);
    expect(counts.missed, JSON.stringify(scores.filter((s) => s.outcome === 'missed'))).toBe(0);
    if (file !== 'rx-demo-smudged.png') expect(counts.wrong_flagged, file).toBe(0);
  });

  it('the smudged Aspirin strength is flagged, never right or silently wrong', () => {
    const c = BENCHMARK_SET.find((x) => x.file === 'rx-demo-smudged.png')!;
    const aspirin = score(PRINTED[c.file], c.lines).scores.filter((s) => s.line === 'Aspirin');
    expect(aspirin.find((s) => s.field === 'strength')).toMatchObject({ outcome: 'wrong_flagged', expected: '75', read: '7? mg' });
  });

  it('from a photo, strength, unit and frequency are always asked; names are not', () => {
    const c = BENCHMARK_SET.find((x) => x.file === 'rx-printed-clean.png')!;
    const scores = score(PRINTED[c.file], c.lines).scores;
    expect(new Set(scores.filter((s) => ['strength', 'unit', 'frequency'].includes(s.field)).map((s) => s.outcome))).toEqual(new Set(['right_asked']));
    expect(new Set(scores.filter((s) => ['medicine_name', 'ingredient'].includes(s.field)).map((s) => s.outcome))).toEqual(new Set(['right']));
    expect(needsCloud(parsePages([{ page: 1, text: PRINTED[c.file] }]), 0.9)).toBe(false);
  });
});

describe('scoring', () => {
  const amlodipine: ExpectedLine[] = [{ productName: 'Amlodipine', ingredient: 'amlodipine', strength: 10, unit: 'mg', dosesPerDay: 1 }];

  it('a wrong value that is not flagged is the dangerous outcome', () => {
    // From a text layer nothing is asked, so a misread strength would go through unflagged.
    const { scores } = score('Tab. Amlodipine 5 mg 1-0-1', amlodipine, 'pdf_text');
    expect(scores.map((s) => [s.field, s.outcome])).toEqual([
      ['medicine_name', 'right'], ['ingredient', 'right'], ['strength', 'wrong'], ['unit', 'right'], ['frequency', 'wrong'],
    ]);
  });

  it('a misread name: the line is found by its name, and the ingredient read is compared', () => {
    const { scores } = score('Tab. Amlodipine 10 mg 1-0-0', [{ productName: 'Amlodipine', ingredient: 'nifedipine', strength: 10, unit: 'mg' }]);
    expect(scores.find((s) => s.field === 'ingredient')).toMatchObject({ outcome: 'wrong', read: 'amlodipine' });
  });

  it('nothing read: every field is "not read"', () => {
    const { scores } = score('', amlodipine);
    expect(countOutcomes(scores)).toEqual({ right: 0, right_asked: 0, wrong_flagged: 0, wrong: 0, missed: 5 });
  });

  it('a line found by name with no strength printed', () => {
    const { scores } = score('Tab. Amlodipine 1-0-0', [{ productName: 'Amlodipine', ingredient: 'amlodipine', strength: 10, unit: 'mg' }]);
    expect(scores.find((s) => s.field === 'strength')!.outcome).not.toBe('right');
  });
});

describe('the Markdown table', () => {
  const row = (over: Partial<BenchmarkRow>): BenchmarkRow => ({
    image: 'a.png', engine: 'tesseract', coldSeconds: 12.34, warmSeconds: 1.2, downloadedBytes: 4_500_000, storedBytes: 2048,
    confidence: 0.876, cloudOffered: false, scores: [], error: '', ...over,
  });

  it('per image, per engine totals, and the dangerous fields listed', () => {
    const rows = [
      row({ scores: [{ line: 'Telma 40', field: 'strength', expected: '40', read: '4|0', outcome: 'wrong' }, { line: 'Telma 40', field: 'unit', expected: 'mg', read: 'mg', outcome: 'right_asked' }] }),
      row({ image: 'b|c.png', engine: 'paddle', coldSeconds: null, warmSeconds: null, downloadedBytes: null, storedBytes: null, confidence: null, cloudOffered: null, error: 'model failed\nto load' }),
      row({ image: 'd.png', cloudOffered: true, warmSeconds: 2.8, downloadedBytes: 300, storedBytes: 0 }),
    ];
    const md = toMarkdown(rows, { label: 'Pixel 6a | Chrome', userAgent: 'UA', date: '2026-11-20' });
    expect(md).toContain('#### OCR benchmark: Pixel 6a \\| Chrome, 2026-11-20');
    expect(md).toContain('| a.png | tesseract | 12.3 | 1.2 | 4.3 MB | 2 KB | 0.88 | 0 | 1 | 0 | 1 | 0 | no |');
    expect(md).toContain('| b\\|c.png | paddle | – | – | – | – | – | – | – | – | – | – | failed: model failed to load |');
    expect(md).toContain('| d.png | tesseract | – | 2.8 | 300 B | 0 B |'.replace('| – |', '| 12.3 |'));
    expect(md).toContain('| tesseract | 2 | 2.0 | 0 | 1 | 0 | 1 | 0 | 1 |');
    expect(md).toContain('| paddle | 0 | – | 0 | 0 | 0 | 0 | 0 | 0 |');
    expect(md).toContain('- a.png, tesseract: Telma 40, strength read as "4\\|0", printed "40"');
    expect(toMarkdown([], { label: '', userAgent: 'UA', date: 'd' })).toContain('unnamed device');
    expect(toMarkdown([row({})], { label: 'x', userAgent: 'u', date: 'd' })).toContain('Wrong and not flagged: none.');
    const blank = toMarkdown([row({ scores: [{ line: 'X', field: 'ingredient', expected: 'x', read: null, outcome: 'wrong' }] })], { label: 'x', userAgent: 'u', date: 'd' });
    expect(blank).toContain('X, ingredient read as "", printed "x"');
  });

  it('formats sizes', () => {
    expect([formatBytes(null), formatBytes(0), formatBytes(2048), formatBytes(5 * 1024 * 1024)]).toEqual(['–', '0 B', '2 KB', '5.0 MB']);
  });
});
