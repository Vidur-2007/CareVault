// Imported by UI tests. The frozen global setup (src/test/setup.ts) keeps Testing Library's
// 1 s default for findBy* and Vitest's 5 s per test. The screens load lazily and each runs several
// queries; with 35 jsdom files in parallel on a busy machine the first test of a file can need
// more, so both limits are raised for the UI tests only.
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 20000 });
