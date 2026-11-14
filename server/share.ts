// The share store: encrypted passports, kept until they expire or are revoked.
// The server sees ciphertext only and cannot read a passport.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

export const MAX_CIPHERTEXT_CHARS = 200 * 1024;
export const MAX_SHARE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShareRow {
  id: string;
  ciphertext: string;
  iv: string;
  expires_at: string;
  revoke_token_hash: string;
  revoked: boolean;
}

export interface ShareStore {
  create(row: Omit<ShareRow, 'id' | 'revoked'>): Promise<string>;
  get(id: string): Promise<ShareRow | null>;
  revoke(id: string): Promise<void>;
  /** One cheap query, so the free Supabase project is not paused for inactivity. */
  ping(): Promise<boolean>;
}

/** The minimum of the Supabase client this file uses, so tests can pass a fake. */
export type SupabaseLike = Pick<SupabaseClient, 'from'>;

export function createSupabaseShareStore(client: SupabaseLike): ShareStore {
  const columns = 'id, ciphertext, iv, expires_at, revoke_token_hash, revoked';
  return {
    async create(row) {
      const { data, error } = await client.from('shares').insert(row).select('id').single();
      if (error || !data) throw new Error('The share could not be stored.');
      return (data as { id: string }).id;
    },
    async get(id) {
      const { data, error } = await client.from('shares').select(columns).eq('id', id).maybeSingle();
      if (error) throw new Error('The share could not be read.');
      return (data as ShareRow | null) ?? null;
    },
    async revoke(id) {
      const { error } = await client.from('shares').update({ revoked: true }).eq('id', id);
      if (error) throw new Error('The share could not be revoked.');
    },
    async ping() {
      const { error } = await client.from('shares').select('id').limit(1);
      return !error;
    },
  };
}

export function supabaseShareStoreFromEnv(env: NodeJS.ProcessEnv): ShareStore | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createSupabaseShareStore(
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const createBody = z.object({
  ciphertext: base64url.min(1),
  iv: base64url.min(8).max(64),
  expiresAt: z.iso.datetime({ offset: true }),
});
const uuid = z.uuid();

export interface ShareRouteOptions {
  store: ShareStore | null;
  now?: () => Date;
}

export function shareRoutes({ store, now = () => new Date() }: ShareRouteOptions): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (!store) return c.json({ error: 'Sharing is not set up on this server.' }, 503);
    await next();
  });

  app.post(
    '/',
    bodyLimit({ maxSize: MAX_CIPHERTEXT_CHARS + 2048, onError: (c) => c.json({ error: 'The passport is too large to share.' }, 413) }),
    async (c) => {
      const parsed = createBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'The share request is not valid.' }, 400);
      const { ciphertext, iv, expiresAt } = parsed.data;
      if (ciphertext.length > MAX_CIPHERTEXT_CHARS) return c.json({ error: 'The passport is too large to share.' }, 413);

      const current = now().getTime();
      const requested = Date.parse(expiresAt);
      if (requested <= current) return c.json({ error: 'The expiry time has already passed.' }, 400);
      // Never longer than seven days, whatever was asked for.
      const expires = new Date(Math.min(requested, current + MAX_SHARE_MS));

      const revokeToken = randomBytes(32).toString('base64url');
      const id = await store!.create({
        ciphertext,
        iv,
        expires_at: expires.toISOString(),
        revoke_token_hash: hashToken(revokeToken),
      });
      return c.json({ id, revokeToken, expiresAt: expires.toISOString() }, 201);
    },
  );

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!uuid.safeParse(id).success) return c.json({ error: 'This link does not exist.' }, 404);
    const row = await store!.get(id);
    if (!row) return c.json({ error: 'This link does not exist.' }, 404);
    if (row.revoked) return c.json({ error: 'This link was revoked.', reason: 'revoked' }, 410);
    if (Date.parse(row.expires_at) <= now().getTime()) return c.json({ error: 'This link has expired.', reason: 'expired' }, 410);
    c.header('cache-control', 'no-store');
    return c.json({ ciphertext: row.ciphertext, iv: row.iv });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!uuid.safeParse(id).success) return c.json({ error: 'This link does not exist.' }, 404);
    const row = await store!.get(id);
    if (!row) return c.json({ error: 'This link does not exist.' }, 404);
    const token = c.req.header('x-revoke-token') ?? '';
    if (!token || !sameHash(hashToken(token), row.revoke_token_hash)) {
      return c.json({ error: 'This link cannot be revoked from here.' }, 403);
    }
    if (!row.revoked) await store!.revoke(id);
    return c.body(null, 204);
  });

  return app;
}
