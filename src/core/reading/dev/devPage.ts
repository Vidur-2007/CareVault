// OCR benchmark harness (core spec step 10). Open /src/core/reading/dev/index.html on the
// Vite dev server, on a phone. Not linked from the app and not part of the production build.
//
// For every image and both engines: a cold read (a new engine, so it includes starting the
// engine and, the first time, downloading its model) and a warm read (the same engine again).
// What was read goes through the real v2 parser and field-evidence rules, then each critical
// field is scored against what is printed. Nothing is uploaded.
import type { ParsedDocument } from '../../v2/reading/parse';
import { parsePages } from '../../v2/reading/parse';
import { createPaddleEngineV2, createTesseractEngineV2, type OcrEngineV2, type OcrPage } from '../../v2/reading/ocr';
import { needsCloud } from '../../v2/reading/read';
import { scoreReading, toMarkdown, countOutcomes, formatBytes, type BenchmarkCase, type BenchmarkRow } from '../../v2/reading/benchmark';
import { buildEvidence } from '../../v2/rules/verify';
import { BENCHMARK_SET } from './benchmarkSet';

const IMAGES = import.meta.glob('./benchmark/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Tesseract.js first: the app's order until these results are in. */
const ENGINES: readonly { name: string; make: () => OcrEngineV2 }[] = [
  { name: 'tesseract', make: createTesseractEngineV2 },
  { name: 'paddle', make: createPaddleEngineV2 },
];

const rows: BenchmarkRow[] = [];
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const seconds = (ms: number) => Math.round(ms / 100) / 10;
const status = (text: string) => {
  byId('status').textContent = text;
};

/**
 * Bytes this page saw arrive. Resource timing only covers requests made by the page itself,
 * and cross-origin servers may hide sizes; a model fetched inside a worker is not visible.
 * "Stored" (the growth of this site's storage) catches models the engines cache.
 */
function downloadedSoFar(): number {
  return performance.getEntriesByType('resource').reduce((sum, e) => {
    const r = e as PerformanceResourceTiming;
    return sum + (r.transferSize || r.encodedBodySize || 0);
  }, 0);
}

async function storedSoFar(): Promise<number | null> {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    return null;
  }
}

function evidenceFor(parsed: ParsedDocument, page: OcrPage) {
  let n = 0;
  return buildEvidence(
    { profileId: 'bench', documentId: 'bench', source: 'ocr', parsed, ocrLines: page.lines.map((l) => ({ ...l, page: 1 })), patientNameRead: null, patientMatch: 'not_found' },
    { now: new Date().toISOString(), newId: () => `bench-${(n += 1)}` },
  );
}

async function runOne(name: string, image: Blob, makeEngine: () => OcrEngineV2, truth: BenchmarkCase | null): Promise<BenchmarkRow> {
  const engine = makeEngine();
  const row: BenchmarkRow = {
    image: name, engine: engine.name, coldSeconds: null, warmSeconds: null, downloadedBytes: null, storedBytes: null,
    confidence: null, cloudOffered: null, scores: [], error: '',
  };
  try {
    const bytesBefore = downloadedSoFar();
    const storedBefore = await storedSoFar();
    let started = performance.now();
    await engine.recognize(image);
    row.coldSeconds = seconds(performance.now() - started);
    row.downloadedBytes = downloadedSoFar() - bytesBefore;
    const storedAfter = await storedSoFar();
    row.storedBytes = storedBefore === null || storedAfter === null ? null : Math.max(0, storedAfter - storedBefore);

    started = performance.now();
    const page = await engine.recognize(image);
    row.warmSeconds = seconds(performance.now() - started);

    const parsed = parsePages([{ page: 1, text: page.text }]);
    row.confidence = page.confidence;
    row.cloudOffered = needsCloud(parsed, page.confidence);
    row.scores = truth ? scoreReading(truth.lines, parsed, evidenceFor(parsed, page)) : [];
    show(row, page.text, parsed);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    show(row, '', null);
  } finally {
    await engine.dispose().catch(() => undefined);
  }
  return row;
}

function show(row: BenchmarkRow, text: string, parsed: ParsedDocument | null) {
  const c = countOutcomes(row.scores);
  const tr = document.createElement('tr');
  const cells = [
    row.image, row.engine, row.coldSeconds ?? '–', row.warmSeconds ?? '–', formatBytes(row.downloadedBytes), formatBytes(row.storedBytes),
    row.confidence === null ? '–' : row.confidence.toFixed(2),
    row.error ? 'failed' : `${c.right} / ${c.right_asked} / ${c.wrong_flagged} / ${c.wrong} / ${c.missed}`,
    row.error || (row.cloudOffered ? 'yes' : 'no'),
  ];
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.append(td);
  }
  if (c.wrong > 0) tr.className = 'danger';
  byId('rows').append(tr);

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `${row.image}, ${row.engine}`;
  const pre = document.createElement('pre');
  const scored = row.scores.map((s) => `${s.outcome.padEnd(13)} ${s.line}: ${s.field} read "${s.read ?? ''}", printed "${s.expected}"`).join('\n');
  const lines = parsed?.lines.map((l) => `${l.productName} | ${l.ingredients.map((i) => `${i.name} ${i.strength ?? '?'} ${i.unit ?? '?'}`).join(' + ')} | ${l.dosesPerDay ?? '?'}/day`).join('\n') ?? '';
  pre.textContent = row.error || `${scored}\n\nParsed lines:\n${lines}\n\nText read:\n${text}`;
  details.append(summary, pre);
  byId('texts').append(details);
}

async function runAll(items: { name: string; image: Blob; truth: BenchmarkCase | null }[]) {
  const buttons = [...document.querySelectorAll('button, input')] as HTMLButtonElement[];
  buttons.forEach((b) => (b.disabled = true));
  try {
    for (const engine of ENGINES) {
      for (const [i, item] of items.entries()) {
        status(`Reading ${i + 1} of ${items.length} with ${engine.name}…`);
        rows.push(await runOne(item.name, item.image, engine.make, item.truth));
      }
    }
    status(`Done: ${rows.length} reads. Press "Copy results".`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function runSet() {
  const items = await Promise.all(BENCHMARK_SET.map(async (truth) => {
    const url = IMAGES[`./benchmark/${truth.file}`];
    return { name: truth.file, image: await (await fetch(url)).blob(), truth };
  }));
  await runAll(items);
}

const markdown = () => toMarkdown(rows, { label: byId<HTMLInputElement>('device').value.trim(), userAgent: navigator.userAgent, date: new Date().toISOString().slice(0, 10) });

byId<HTMLButtonElement>('run').addEventListener('click', () => void runSet());

// ?autorun starts the set on load (and ?device=… names the phone), so a run can be started from a link.
const params = new URLSearchParams(location.search);
if (params.has('device')) byId<HTMLInputElement>('device').value = params.get('device') ?? '';
if (params.has('autorun')) {
  void runSet().then(() => {
    // Left on the page for a script or a person to read.
    byId<HTMLTextAreaElement>('markdown').value = markdown();
    byId('markdown').hidden = false;
    document.body.dataset.done = 'true';
  });
}

byId<HTMLInputElement>('files').addEventListener('change', async (event) => {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  // Your own photos have no answer key: they are timed and checked for the cloud offer only.
  await runAll(files.map((file) => ({ name: file.name, image: file, truth: null })));
});

byId<HTMLButtonElement>('copy').addEventListener('click', async () => {
  const text = markdown();
  try {
    await navigator.clipboard.writeText(text);
    status('Copied. Paste it into docs/progress-core.md.');
  } catch {
    // Some phones refuse the clipboard over plain http: show it to copy by hand.
    byId<HTMLTextAreaElement>('markdown').value = text;
    byId('markdown').hidden = false;
    status('Could not copy here: select the text below and copy it.');
  }
});
