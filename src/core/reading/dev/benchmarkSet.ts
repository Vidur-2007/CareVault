// The synthetic OCR benchmark set: what each image in ./benchmark/ actually says.
// Images are rendered from ./benchmark-html/ by render-benchmark.sh. Dev only.
import type { BenchmarkCase } from '../../v2/reading/benchmark';

export const BENCHMARK_SET: readonly BenchmarkCase[] = [
  {
    file: 'pack-dolo-650.png', kind: 'pack', what: 'Pack, clean, plain type',
    lines: [{ productName: 'Dolo 650', ingredient: 'paracetamol', strength: 650, unit: 'mg' }],
  },
  {
    file: 'pack-telma-40.png', kind: 'pack', what: 'Pack, clean, plain type',
    lines: [{ productName: 'Telma 40', ingredient: 'telmisartan', strength: 40, unit: 'mg' }],
  },
  {
    file: 'pack-crocin-advance.png', kind: 'pack', what: 'Pack, stylised script brand, white on red',
    lines: [{ productName: 'Crocin Advance', ingredient: 'paracetamol', strength: 500, unit: 'mg' }],
  },
  {
    file: 'pack-glycomet-glare.png', kind: 'pack', what: 'Pack, tilted, glare across the strength line',
    lines: [{ productName: 'Glycomet 500', ingredient: 'metformin', strength: 500, unit: 'mg' }],
  },
  {
    file: 'pack-pan-40-blurred.png', kind: 'pack', what: 'Pack, tilted and blurred, like a quick phone photo',
    lines: [{ productName: 'Pan 40', ingredient: 'pantoprazole', strength: 40, unit: 'mg' }],
  },
  {
    file: 'rx-printed-clean.png', kind: 'prescription', what: 'Printed prescription, slight tilt, old-style numerals',
    lines: [
      { productName: 'Amlodipine', ingredient: 'amlodipine', strength: 10, unit: 'mg', dosesPerDay: 1 },
      { productName: 'Telmisartan', ingredient: 'telmisartan', strength: 40, unit: 'mg', dosesPerDay: 1 },
      { productName: 'Rosuvastatin', ingredient: 'rosuvastatin', strength: 10, unit: 'mg', dosesPerDay: 1 },
    ],
  },
  {
    // The second digit of the Aspirin strength is an ink blot. The safe result is "flagged".
    file: 'rx-demo-smudged.png', kind: 'prescription', what: 'The demo prescription, Aspirin strength smudged',
    lines: [
      { productName: 'Amlodipine', ingredient: 'amlodipine', strength: 10, unit: 'mg', dosesPerDay: 1 },
      { productName: 'Telmisartan', ingredient: 'telmisartan', strength: 80, unit: 'mg', dosesPerDay: 1 },
      { productName: 'Rosuvastatin', ingredient: 'rosuvastatin', strength: 10, unit: 'mg', dosesPerDay: 1 },
      { productName: 'Aspirin', ingredient: 'aspirin', strength: 75, unit: 'mg', dosesPerDay: 1 },
    ],
  },
  {
    file: 'rx-handwriting-style.png', kind: 'prescription', what: 'Prescription in a handwriting-style font',
    lines: [{ productName: 'Metformin', ingredient: 'metformin', strength: 500, unit: 'mg', dosesPerDay: 2 }],
  },
];
