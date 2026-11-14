// Shared Vitest setup (jsdom). Frozen with vite.config.ts.
// Core tests that need IndexedDB import 'fake-indexeddb/auto' themselves.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
