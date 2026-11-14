// The CareVault server: two small APIs and the built app.
//   POST   /api/extract      one image -> structured fields (Gemini)
//   POST   /api/share        store an encrypted passport
//   GET    /api/share/:id    fetch it
//   DELETE /api/share/:id    revoke it
//   GET    /api/health       liveness, and one cheap share-store query
//   everything else          the built app from dist/, with index.html as the fallback
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { extractRoutes, geminiExtractorFromEnv, type Extractor } from './extract.ts';
import { shareRoutes, supabaseShareStoreFromEnv, type ShareStore } from './share.ts';

export interface AppOptions {
  extractor: Extractor | null;
  shareStore: ShareStore | null;
  now?: () => Date;
  /** Requests per client per minute on /api. */
  rateLimit?: number;
  /** Where the built app is. Null serves the API only. */
  staticRoot?: string | null;
}

function clientAddress(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** A fixed one-minute window per client address, kept in memory. */
function rateLimiter(limit: number, now: () => Date) {
  const windows = new Map<string, { start: number; count: number }>();
  return (address: string): boolean => {
    const time = now().getTime();
    if (windows.size > 10_000) {
      for (const [key, w] of windows) if (time - w.start >= 60_000) windows.delete(key);
    }
    const current = windows.get(address);
    if (!current || time - current.start >= 60_000) {
      windows.set(address, { start: time, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

export function createApp(options: AppOptions): Hono {
  const now = options.now ?? (() => new Date());
  const allow = rateLimiter(options.rateLimit ?? 60, now);
  const app = new Hono();

  app.onError((_error, c) => c.json({ error: 'Something went wrong on the server.' }, 500));

  app.use('/api/*', async (c, next) => {
    if (!allow(clientAddress(c))) {
      c.header('retry-after', '60');
      return c.json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
    }
    await next();
  });

  app.get('/api/health', async (c) => {
    const shareStore = options.shareStore ? await options.shareStore.ping().catch(() => false) : false;
    return c.json({ ok: true, shareStore, cloudReading: options.extractor !== null });
  });

  app.route('/api/extract', extractRoutes(options.extractor));
  app.route('/api/share', shareRoutes({ store: options.shareStore, now }));
  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  if (options.staticRoot) {
    app.use('/*', serveStatic({ root: options.staticRoot }));
    // Client-side routes such as /share/<id> are served the app shell.
    app.get('*', serveStatic({ root: options.staticRoot, path: 'index.html' }));
  }
  return app;
}

function start() {
  const extractor = geminiExtractorFromEnv(process.env);
  const shareStore = supabaseShareStoreFromEnv(process.env);
  const app = createApp({ extractor, shareStore, staticRoot: './dist' });
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`CareVault server listening on http://localhost:${info.port}`);
    if (!extractor) console.log('Cloud reading is off: set GEMINI_API_KEY and GEMINI_MODEL.');
    if (!shareStore) console.log('Sharing is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
