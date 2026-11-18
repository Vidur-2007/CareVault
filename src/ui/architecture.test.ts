/// <reference types="node" />
// Fails if any file under src/ui imports from src/core (overview spec section 5: the UI talks only to
// the contract, through src/services). Static imports, re-exports, dynamic import() and require().
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(UI_DIR, '..');
const CORE_DIR = resolve(SRC_DIR, 'core');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function coreImports(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    const target = spec.startsWith('.') ? resolve(dirname(file), spec) : spec;
    const inCore = spec.startsWith('.') ? target === CORE_DIR || target.startsWith(CORE_DIR + sep) : /(^|\/)src\/core(\/|$)/.test(spec);
    if (inCore) found.push(spec);
  }
  return found;
}

describe('architecture', () => {
  it('no file under src/ui imports from src/core', () => {
    const offenders = sourceFiles(UI_DIR)
      .map((file) => ({ file: relative(SRC_DIR, file), imports: coreImports(file, readFileSync(file, 'utf8')) }))
      .filter((f) => f.imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('the check itself catches the forms an import can take', () => {
    const file = join(UI_DIR, 'screens', 'Example.tsx');
    const sample = [
      "import { createRealServices } from '../../core/createRealServices';",
      "export { x } from '../../core/rules/totals';",
      "const m = await import('../../core/db/schema');",
      "import '../../core/side-effect';",
      "import { services } from '../../services';",
      "import type { Medicine } from '../../contract/types';",
    ].join('\n');
    expect(coreImports(file, sample).sort()).toEqual([
      '../../core/createRealServices',
      '../../core/db/schema',
      '../../core/rules/totals',
      '../../core/side-effect',
    ]);
  });
});
