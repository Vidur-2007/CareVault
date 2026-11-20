// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, SYSTEM_INSTRUCTION, userPrompt } from './extract.ts';
import { createApp } from './index.ts';
import { createSupabaseShareStore, hashToken, MAX_CIPHERTEXT_CHARS, type ShareRow, type SupabaseLike } from './share.ts';

/** A stand-in for the Supabase client: just the query shapes share.ts uses, over an array. */
function fakeSupabase(rows: ShareRow[] = []) {
  let failing = false;
  let nextId = 0;
  const uuid = () => `00000000-0000-4000-8000-${String((nextId += 1)).padStart(12, '0')}`;
  const error = () => (failing ? { message: 'database is down' } : null);

  const client = {
    from(table: string) {
      expect(table).toBe('shares');
      return {
        insert(row: Omit<ShareRow, 'id' | 'revoked'>) {
          return {
            select: () => ({
              single: async () => {
                if (failing) return { data: null, error: error() };
                const stored = { ...row, id: uuid(), revoked: false };
                rows.push(stored);
                return { data: { id: stored.id }, error: null };
              },
            }),
          };
        },
        select() {
          return {
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => ({ data: failing ? null : (rows.find((r) => r.id === id) ?? null), error: error() }),
            }),
            limit: async () => ({ data: failing ? null : rows.slice(0, 1), error: error() }),
          };
        },
        update(patch: Partial<ShareRow>) {
          return {
            eq: async (_column: string, id: string) => {
              if (!failing) Object.assign(rows.find((r) => r.id === id) ?? {}, patch);
              return { error: error() };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseLike, rows, fail: (value: boolean) => (failing = value) };
}

function setup(over: { extractor?: Parameters<typeof createApp>[0]['extractor']; rateLimit?: number } = {}) {
  const db = fakeSupabase();
  let time = new Date('2026-11-14T10:00:00.000Z');
  const app = createApp({
    extractor: over.extractor === undefined ? null : over.extractor,
    shareStore: createSupabaseShareStore(db.client),
    now: () => time,
    rateLimit: over.rateLimit ?? 1000,
    staticRoot: null,
  });
  const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, db, json, setTime: (iso: string) => (time = new Date(iso)) };
}

const share = (expiresAt = '2026-11-14T18:00:00.000Z') => ({ ciphertext: 'Y2lwaGVydGV4dA', iv: 'aXZpdml2aXZpdml2', expiresAt });

describe('share routes', () => {
  it('create stores ciphertext and a hash of the revoke token, never the token', async () => {
    const { json, db } = setup();
    const response = await json('POST', '/api/share', share());
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; revokeToken: string; expiresAt: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.revokeToken.length).toBeGreaterThanOrEqual(40);
    expect(body.expiresAt).toBe('2026-11-14T18:00:00.000Z');
    expect(db.rows).toEqual([
      { id: body.id, ciphertext: 'Y2lwaGVydGV4dA', iv: 'aXZpdml2aXZpdml2', expires_at: '2026-11-14T18:00:00.000Z', revoke_token_hash: hashToken(body.revokeToken), revoked: false },
    ]);
    expect(JSON.stringify(db.rows)).not.toContain(body.revokeToken);
  });

  it('fetch returns the ciphertext and iv', async () => {
    const { json } = setup();
    const { id } = (await (await json('POST', '/api/share', share())).json()) as { id: string };
    const response = await json('GET', `/api/share/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ciphertext: 'Y2lwaGVydGV4dA', iv: 'aXZpdml2aXZpdml2' });
  });

  it('an expired share gives 410', async () => {
    const { json, setTime } = setup();
    const { id } = (await (await json('POST', '/api/share', share())).json()) as { id: string };
    setTime('2026-11-14T18:00:00.000Z');
    const response = await json('GET', `/api/share/${id}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ reason: 'expired' });
  });

  it('a revoked share gives 410, and revoking twice is harmless', async () => {
    const { json } = setup();
    const { id, revokeToken } = (await (await json('POST', '/api/share', share())).json()) as { id: string; revokeToken: string };
    expect((await json('DELETE', `/api/share/${id}`, undefined, { 'x-revoke-token': revokeToken })).status).toBe(204);
    const response = await json('GET', `/api/share/${id}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ reason: 'revoked' });
    expect((await json('DELETE', `/api/share/${id}`, undefined, { 'x-revoke-token': revokeToken })).status).toBe(204);
  });

  it('a wrong or missing revoke token gives 403 and revokes nothing', async () => {
    const { json, db } = setup();
    const { id } = (await (await json('POST', '/api/share', share())).json()) as { id: string };
    expect((await json('DELETE', `/api/share/${id}`, undefined, { 'x-revoke-token': 'wrong' })).status).toBe(403);
    expect((await json('DELETE', `/api/share/${id}`)).status).toBe(403);
    expect(db.rows[0].revoked).toBe(false);
    expect((await json('GET', `/api/share/${id}`)).status).toBe(200);
  });

  it('unknown or malformed ids give 404', async () => {
    const { json } = setup();
    expect((await json('GET', '/api/share/00000000-0000-4000-8000-999999999999')).status).toBe(404);
    expect((await json('GET', "/api/share/1' or '1'='1")).status).toBe(404);
    expect((await json('DELETE', '/api/share/not-a-uuid', undefined, { 'x-revoke-token': 'x' })).status).toBe(404);
    expect((await json('DELETE', '/api/share/00000000-0000-4000-8000-999999999999', undefined, { 'x-revoke-token': 'x' })).status).toBe(404);
  });

  it('caps the expiry at seven days and rejects one in the past', async () => {
    const { json, db } = setup();
    const response = await json('POST', '/api/share', share('2027-01-01T00:00:00.000Z'));
    expect(((await response.json()) as { expiresAt: string }).expiresAt).toBe('2026-11-21T10:00:00.000Z');
    expect(db.rows[0].expires_at).toBe('2026-11-21T10:00:00.000Z');
    expect((await json('POST', '/api/share', share('2026-11-14T09:59:59.000Z'))).status).toBe(400);
  });

  it('rejects invalid bodies and ciphertext over 200 KB', async () => {
    const { json, app, db } = setup();
    expect((await json('POST', '/api/share', { ciphertext: 'abc' })).status).toBe(400);
    expect((await json('POST', '/api/share', { ...share(), ciphertext: 'not base64url!' })).status).toBe(400);
    expect((await json('POST', '/api/share', { ...share(), expiresAt: 'tomorrow' })).status).toBe(400);
    expect((await app.request('/api/share', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await json('POST', '/api/share', { ...share(), ciphertext: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1) })).status).toBe(413);
    expect((await json('POST', '/api/share', { ...share(), ciphertext: 'A'.repeat(MAX_CIPHERTEXT_CHARS) })).status).toBe(201);
    expect(db.rows).toHaveLength(1);
  });

  it('answers 500 without detail when the database fails, and 503 when sharing is not set up', async () => {
    const { json, db } = setup();
    db.fail(true);
    const response = await json('POST', '/api/share', share());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('database is down');
    const none = createApp({ extractor: null, shareStore: null, staticRoot: null });
    expect((await none.request('/api/share/00000000-0000-4000-8000-000000000001')).status).toBe(503);
  });
});

describe('extract route', () => {
  it('the page goes into the user turn only; the system instruction is unchanged', () => {
    expect(userPrompt()).toBe('Transcribe this image into the fields.');
    expect(userPrompt(2)).toBe('Transcribe this image into the fields. It is page 2 of the document.');
    expect(SYSTEM_INSTRUCTION).toContain('Transcribe only what is printed or written in the image.');
    expect(SYSTEM_INSTRUCTION).not.toMatch(/page/i);
  });


  const image = { imageBase64: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString('base64'), mimeType: 'image/jpeg' };
  const answer = { documentType: 'other', documentDate: null, prescriberName: null, rawText: 'DOLO 650', lines: [] };

  it('passes the image to the extractor and returns its fields as a cloud candidate', async () => {
    const extractor = vi.fn(async () => answer);
    const { json } = setup({ extractor });
    const response = await json('POST', '/api/extract', image);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...answer, engine: 'cloud', needsCloud: false });
    expect(extractor).toHaveBeenCalledWith(image.imageBase64, 'image/jpeg');
    // The page of the document, when the image is one, goes with it.
    await json('POST', '/api/extract', { ...image, page: 3 });
    expect(extractor).toHaveBeenLastCalledWith(image.imageBase64, 'image/jpeg', 3);
  });

  it('validates the body and rejects images over 6 MB', async () => {
    const extractor = vi.fn(async () => answer);
    const { json } = setup({ extractor });
    expect((await json('POST', '/api/extract', { imageBase64: image.imageBase64 })).status).toBe(400);
    expect((await json('POST', '/api/extract', { ...image, mimeType: 'application/pdf' })).status).toBe(400);
    for (const page of [0, -1, 1.5, 501, '2']) expect((await json('POST', '/api/extract', { ...image, page })).status, String(page)).toBe(400);
    expect((await json('POST', '/api/extract', { ...image, imageBase64: '<script>' })).status).toBe(400);
    const tooBig = 'A'.repeat(Math.ceil(((MAX_IMAGE_BYTES + 3000) * 4) / 3));
    expect((await json('POST', '/api/extract', { ...image, imageBase64: tooBig })).status).toBe(413);
    expect((await json('POST', '/api/extract', { ...image, imageBase64: 'A'.repeat(MAX_IMAGE_BYTES * 2) })).status).toBe(413);
    expect(extractor).not.toHaveBeenCalled();
  });

  it('answers 502 without detail when the model fails or returns the wrong shape', async () => {
    const failing = setup({ extractor: async () => { throw new Error('quota exceeded for key AIza-secret'); } });
    const response = await failing.json('POST', '/api/extract', image);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('AIza');
    const wrong = setup({ extractor: async () => ({ lines: 'none' }) });
    expect((await wrong.json('POST', '/api/extract', image)).status).toBe(502);
  });

  it('answers 503 when no key is configured', async () => {
    const { json } = setup({ extractor: null });
    expect((await json('POST', '/api/extract', image)).status).toBe(503);
  });

  it('logs nothing about a request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { json } = setup({ extractor: async () => { throw new Error('boom'); } });
    await json('POST', '/api/extract', image);
    await json('POST', '/api/share', share());
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});

describe('health, rate limit and unknown routes', () => {
  it('health returns 200 and queries the share store once', async () => {
    const { app, db } = setup();
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, shareStore: true, cloudReading: false });
    db.fail(true);
    const down = await app.request('/api/health');
    expect(down.status).toBe(200);
    expect(await down.json()).toMatchObject({ ok: true, shareStore: false });
    const bare = createApp({ extractor: async () => ({}), shareStore: null, staticRoot: null });
    expect(await (await bare.request('/api/health')).json()).toEqual({ ok: true, shareStore: false, cloudReading: true });
  });

  it('limits each client per minute on every /api route', async () => {
    const { app, setTime } = setup({ rateLimit: 3 });
    const from = (ip: string) => app.request('/api/health', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
    expect([(await from('1.1.1.1')).status, (await from('1.1.1.1')).status, (await from('1.1.1.1')).status]).toEqual([200, 200, 200]);
    const blocked = await from('1.1.1.1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect((await from('2.2.2.2')).status).toBe(200);
    setTime('2026-11-14T10:01:00.000Z');
    expect((await from('1.1.1.1')).status).toBe(200);
  });

  it('unknown API routes give a JSON 404', async () => {
    const { app } = setup();
    const response = await app.request('/api/nothing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });
});
