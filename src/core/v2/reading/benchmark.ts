// Scoring for the OCR benchmark (core spec step 10). Pure: what an engine read, turned into
// field evidence by the real v2 rules, compared with what is printed. Used by the dev page in
// src/core/reading/dev/; never by the app.
import type { DoseUnit, FieldEvidence } from '../../../contract/types';
import type { ParsedDocument } from './parse';

export interface ExpectedLine {
  productName: string;
  ingredient: string;
  strength: number;
  unit: DoseUnit;
  /** Only when the image states it (prescriptions). */
  dosesPerDay?: number;
}

export interface BenchmarkCase {
  file: string;
  kind: 'pack' | 'prescription';
  what: string;
  lines: ExpectedLine[];
}

/**
 * Right: correct and not flagged. RightAsked: correct, and the user is asked to check it.
 * WrongFlagged: wrong or unreadable, but flagged, so it cannot reach the routine unchecked.
 * Wrong: wrong and NOT flagged, the dangerous case. Missed: not read at all.
 */
export type Outcome = 'right' | 'right_asked' | 'wrong_flagged' | 'wrong' | 'missed';
export const OUTCOMES: readonly Outcome[] = ['right', 'right_asked', 'wrong_flagged', 'wrong', 'missed'];

export interface FieldScore {
  line: string;
  field: 'medicine_name' | 'ingredient' | 'strength' | 'unit' | 'frequency';
  expected: string;
  read: string | null;
  outcome: Outcome;
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstWord = (text: string) => norm(text).split(' ')[0];

function outcomeOf(evidence: FieldEvidence | undefined, correct: boolean): Outcome {
  if (!evidence) return 'missed';
  const flagged = evidence.status === 'needs_verification';
  if (correct) return flagged ? 'right_asked' : 'right';
  return flagged ? 'wrong_flagged' : 'wrong';
}

/** Each critical field of each printed line, scored against the evidence. */
export function scoreReading(expected: readonly ExpectedLine[], parsed: ParsedDocument, evidence: readonly FieldEvidence[]): FieldScore[] {
  const scores: FieldScore[] = [];
  for (const want of expected) {
    const lineIndex = parsed.lines.findIndex((l) => l.ingredients.some((i) => i.name === want.ingredient));
    const byName = lineIndex >= 0 ? lineIndex : parsed.lines.findIndex((l) => norm(l.productName).includes(firstWord(want.productName)));
    const of = (field: FieldEvidence['field'], ingredientIndex: number | null) =>
      byName < 0 ? undefined : evidence.find((e) => e.field === field && e.lineIndex === byName && e.ingredientIndex === ingredientIndex);
    const push = (field: FieldScore['field'], expectedValue: string, found: FieldEvidence | undefined, correct: (value: string) => boolean) =>
      scores.push({ line: want.productName, field, expected: expectedValue, read: found?.value ?? found?.raw ?? null, outcome: outcomeOf(found, found?.value != null && correct(found.value)) });

    const name = of('medicine_name', null);
    push('medicine_name', want.productName, name, (v) => norm(v).includes(norm(want.productName)));

    // The ingredient compared is the printed one when it was found, else the first one read.
    const ingredientIndex = byName < 0 ? -1 : Math.max(0, parsed.lines[byName].ingredients.findIndex((i) => i.name === want.ingredient));
    push('ingredient', want.ingredient, of('ingredient', ingredientIndex), (v) => v === want.ingredient);
    push('strength', String(want.strength), of('strength', ingredientIndex), (v) => Number(v) === want.strength);
    push('unit', want.unit, of('unit', ingredientIndex), (v) => v === want.unit);
    if (want.dosesPerDay !== undefined) push('frequency', String(want.dosesPerDay), of('frequency', null), (v) => Number(v) === want.dosesPerDay);
  }
  return scores;
}

export interface BenchmarkRow {
  image: string;
  engine: string;
  coldSeconds: number | null;
  warmSeconds: number | null;
  /** Bytes the page saw downloaded during the cold read (see the harness for what it can see). */
  downloadedBytes: number | null;
  /** Growth of this site's stored data during the cold read (models cached by the engine). */
  storedBytes: number | null;
  confidence: number | null;
  cloudOffered: boolean | null;
  scores: FieldScore[];
  error: string;
}

export function countOutcomes(scores: readonly FieldScore[]): Record<Outcome, number> {
  const counts = { right: 0, right_asked: 0, wrong_flagged: 0, wrong: 0, missed: 0 };
  for (const s of scores) counts[s.outcome] += 1;
  return counts;
}

const fixed = (n: number | null, digits: number) => (n === null ? '–' : n.toFixed(digits));

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The table pasted into docs/progress-core.md. */
export function toMarkdown(rows: readonly BenchmarkRow[], device: { label: string; userAgent: string; date: string }): string {
  const out: string[] = [];
  out.push(`#### OCR benchmark: ${cell(device.label || 'unnamed device')}, ${device.date}`, '', `User agent: \`${cell(device.userAgent)}\``, '');
  out.push('| Image | Engine | Cold (s) | Warm (s) | Downloaded | Stored | Confidence | Right | Right, asked | Wrong, flagged | Wrong, NOT flagged | Not read | Cloud offered |');
  out.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of rows) {
    const c = countOutcomes(row.scores);
    const cloud = row.cloudOffered === null ? '–' : row.cloudOffered ? 'yes' : 'no';
    const counts = row.error ? ['–', '–', '–', '–', '–'] : [c.right, c.right_asked, c.wrong_flagged, c.wrong, c.missed].map(String);
    out.push(`| ${cell(row.image)} | ${row.engine} | ${fixed(row.coldSeconds, 1)} | ${fixed(row.warmSeconds, 1)} | ${formatBytes(row.downloadedBytes)} | ${formatBytes(row.storedBytes)} | ${fixed(row.confidence, 2)} | ${counts.join(' | ')} | ${row.error ? `failed: ${cell(row.error)}` : cloud} |`);
  }

  out.push('', '| Engine | Images | Mean warm (s) | Right | Right, asked | Wrong, flagged | Wrong, NOT flagged | Not read | Cloud offered |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const engine of [...new Set(rows.map((r) => r.engine))]) {
    const mine = rows.filter((r) => r.engine === engine && !r.error);
    const c = countOutcomes(mine.flatMap((r) => r.scores));
    const warm = mine.map((r) => r.warmSeconds).filter((s): s is number => s !== null);
    const mean = warm.length ? warm.reduce((a, b) => a + b, 0) / warm.length : null;
    out.push(`| ${engine} | ${mine.length} | ${fixed(mean, 1)} | ${c.right} | ${c.right_asked} | ${c.wrong_flagged} | ${c.wrong} | ${c.missed} | ${mine.filter((r) => r.cloudOffered).length} |`);
  }

  const dangerous = rows.flatMap((r) => r.scores.filter((s) => s.outcome === 'wrong').map((s) => `- ${cell(r.image)}, ${r.engine}: ${s.line}, ${s.field} read as "${cell(s.read ?? '')}", printed "${cell(s.expected)}"`));
  out.push('', dangerous.length ? 'Wrong and not flagged:' : 'Wrong and not flagged: none.');
  out.push(...dangerous);
  return out.join('\n');
}
