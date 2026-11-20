// Fails if any file under src/ui imports from src/core (overview spec section 5: the UI talks only to
// the contract, through src/services). Static imports, re-exports, dynamic import() and require().
//
// Files are read with Vite's import.meta.glob (?raw) rather than node:fs, so the app's typecheck
// stays free of Node types (core tests rely on that).
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Joins and normalises POSIX-style paths relative to src/ui ('./screens/X.tsx' + '../../core/a' -> '../core/a'). */
function resolveFrom(file: string, spec: string): string {
  const parts = file.split('/').slice(0, -1).concat(spec.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Import specifiers in `text` (a file at `file`, relative to src/ui) that point into src/core. */
export function coreImports(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    const inCore = spec.startsWith('.')
      ? /^\.\.\/core(\/|$)/.test(resolveFrom(file, spec))
      : /(^|\/)src\/core(\/|$)/.test(spec);
    if (inCore) found.push(spec);
  }
  return found;
}

describe('architecture', () => {
  it('reads the UI source files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(SOURCES['./app/App.tsx']).toContain('export function App');
  });

  it('no file under src/ui imports from src/core', () => {
    const offenders = Object.entries(SOURCES)
      .map(([file, text]) => ({ file, imports: coreImports(file, text) }))
      .filter((f) => f.imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('the check itself catches the forms an import can take', () => {
    const sample = [
      "import { createRealServices } from '../../core/createRealServices';",
      "export { x } from '../../core/rules/totals';",
      "const m = await import('../../core/db/schema');",
      "import '../../core/side-effect';",
      "import { services } from '../../services';",
      "import type { Medicine } from '../../contract/legacy/types';",
      "import { y } from './core-ish';",
    ].join('\n');
    // From src/ui/screens/, '../../core' is src/core.
    expect(coreImports('./screens/Example.tsx', sample).sort()).toEqual([
      '../../core/createRealServices',
      '../../core/db/schema',
      '../../core/rules/totals',
      '../../core/side-effect',
    ]);
  });
});
