// Manual test page for the OCR engine decision (core spec section 5). Open
// /src/core/reading/dev/index.html on the Vite dev server. Not linked from the app and
// not part of the production build.
import type { OcrEngine } from '../ocr/engine';
import { createPaddleEngine } from '../ocr/paddle';
import { createTesseractEngine } from '../ocr/tesseract';
import { parseText } from '../parse';

interface Row {
  image: string;
  engine: string;
  loadSeconds: number | null;
  readSeconds: number | null;
  confidence: number | null;
  product: string;
  ingredients: string;
  error: string;
}

const engines: OcrEngine[] = [createTesseractEngine(), createPaddleEngine()];
const warmedUp = new Set<string>();
const results: Row[] = [];

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const seconds = (ms: number) => Math.round(ms / 100) / 10;

function show(row: Row, text: string) {
  const tr = document.createElement('tr');
  const cells = [
    row.image,
    row.engine,
    row.loadSeconds ?? '(loaded)',
    row.readSeconds ?? '',
    row.confidence === null ? '' : row.confidence.toFixed(2),
    row.error || row.product || '(none)',
    row.ingredients,
  ];
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.append(td);
  }
  byId('rows').append(tr);

  const heading = document.createElement('p');
  heading.textContent = `${row.image}, ${row.engine}`;
  const pre = document.createElement('pre');
  pre.textContent = row.error || text;
  byId('texts').append(heading, pre);
}

async function run(file: File, engine: OcrEngine) {
  const row: Row = {
    image: file.name, engine: engine.name, loadSeconds: null, readSeconds: null,
    confidence: null, product: '', ingredients: '', error: '',
  };
  let text = '';
  try {
    const started = performance.now();
    let result = await engine.recognize(file);
    const first = performance.now() - started;
    if (!warmedUp.has(engine.name)) {
      // The first call includes downloading and starting the engine. Read again to time the read alone.
      warmedUp.add(engine.name);
      const again = performance.now();
      result = await engine.recognize(file);
      row.readSeconds = seconds(performance.now() - again);
      row.loadSeconds = seconds(Math.max(0, first - (performance.now() - again)));
    } else {
      row.readSeconds = seconds(first);
    }
    text = result.text;
    row.confidence = result.confidence;
    const line = parseText(text).lines[0];
    row.product = line?.productName ?? '';
    row.ingredients = (line?.ingredients ?? []).map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + ');
  } catch (error) {
    row.error = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  results.push(row);
  show(row, text);
}

byId<HTMLInputElement>('files').addEventListener('change', async (event) => {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  for (const file of files) {
    for (const engine of engines) {
      byId('status').textContent = `Reading ${file.name} with ${engine.name}...`;
      await run(file, engine);
    }
  }
  byId('status').textContent = `Done: ${files.length} image(s).`;
});

byId('copy').addEventListener('click', async () => {
  const header = '| Image | Engine | Load (s) | Read (s) | Confidence | Product read | Ingredients read |\n| --- | --- | --- | --- | --- | --- | --- |';
  const lines = results.map(
    (r) => `| ${r.image} | ${r.engine} | ${r.loadSeconds ?? ''} | ${r.readSeconds ?? ''} | ${r.confidence?.toFixed(2) ?? ''} | ${r.error || r.product || '(none)'} | ${r.ingredients} |`,
  );
  const report = [`Device: ${navigator.userAgent}`, '', header, ...lines].join('\n');
  try {
    await navigator.clipboard.writeText(report);
    byId('status').textContent = 'Copied.';
  } catch {
    const pre = document.createElement('pre');
    pre.textContent = report;
    byId('texts').prepend(pre);
    byId('status').textContent = 'Could not copy. The results are shown below; select and copy them.';
  }
});
