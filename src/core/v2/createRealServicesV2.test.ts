// The Phase 0 stub: every v2 method exists and rejects as not built yet.
// Laptop A replaces these expectations step by step as methods are built.
import { describe, expect, it } from 'vitest';
import { ServiceError } from '../../contract/types';
import { createRealServicesV2 } from './createRealServicesV2';

describe('real services v2 (Phase 0 stub)', () => {
  it('every method rejects with ServiceError("unknown", "not built yet")', async () => {
    const s = createRealServicesV2();
    let methods = 0;
    for (const [group, value] of Object.entries(s)) {
      if (group === 'subscribe') continue;
      for (const [name, fn] of Object.entries(value as Record<string, (...args: unknown[]) => Promise<unknown>>)) {
        methods += 1;
        await expect(fn(), `${group}.${name}`).rejects.toBeInstanceOf(ServiceError);
        await expect(fn()).rejects.toMatchObject({ code: 'unknown', message: 'not built yet' });
      }
    }
    expect(methods).toBe(60); // every method of contract v2 except subscribe
    const unsubscribe = s.subscribe(() => undefined);
    expect(typeof unsubscribe).toBe('function');
  });
});
