// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/legacy/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/legacy/services';
import type { ServiceError } from '../../contract/legacy/types';
import { createRealServices } from '../createRealServices';
import { CareVaultDb } from '../db/schema';
import { toBase64Url } from '../share/crypto';
import { downloadAttachment, findCandidates, MAX_CANDIDATES, SEARCH_QUERY } from './api';
import { createTokenSource, GMAIL_SCOPE, type TokenSource } from './token';

const PROFILE = IDS.profile;
const pdfBytes = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

interface Mail {
  id: string;
  subject: string;
  from: string;
  internalDate: string;
  attachments: { filename: string; mimeType: string; attachmentId: string; data: Uint8Array }[];
}

const INBOX: Mail[] = [
  {
    id: 'm1', subject: 'Your HbA1c lab report', from: 'Lakeside Diagnostics <reports@lakeside.example>',
    internalDate: String(Date.parse('2026-11-12T14:35:00Z')),
    attachments: [{ filename: 'HbA1c_report.pdf', mimeType: 'application/pdf', attachmentId: 'a1', data: pdfBytes('hba1c') }],
  },
  {
    id: 'm2', subject: 'Lipid profile result', from: 'reports@lakeside.example',
    internalDate: String(Date.parse('2026-11-10T09:00:00Z')),
    attachments: [
      { filename: 'logo.png', mimeType: 'image/png', attachmentId: 'a2', data: new Uint8Array([1]) },
      { filename: 'lipid-profile.PDF', mimeType: 'application/octet-stream', attachmentId: 'a3', data: pdfBytes('lipid') },
    ],
  },
  { id: 'm3', subject: 'Report attached?', from: 'someone@example.com', internalDate: '0', attachments: [] },
];

/** A stand-in for the Gmail REST API over the inbox above. */
function gmail(inbox: Mail[] = INBOX) {
  const requests: { url: string; authorization: string | null }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get('authorization');
    requests.push({ url: url.pathname + url.search, authorization });
    if (authorization !== 'Bearer good-token') return new Response('{}', { status: 401 });
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (path === '/messages') return json({ messages: inbox.map((m) => ({ id: m.id })) });
    const attachment = path.match(/^\/messages\/([^/]+)\/attachments\/([^/]+)$/);
    if (attachment) {
      const found = inbox.find((m) => m.id === attachment[1])?.attachments.find((a) => a.attachmentId === attachment[2]);
      return found ? json({ size: found.data.length, data: toBase64Url(found.data) }) : new Response('{}', { status: 404 });
    }
    const message = path.match(/^\/messages\/([^/]+)$/);
    const mail = message && inbox.find((m) => m.id === message[1]);
    if (!mail) return new Response('{}', { status: 404 });
    return json({
      id: mail.id,
      internalDate: mail.internalDate,
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'Subject', value: mail.subject }, { name: 'From', value: mail.from }],
        parts: [
          { mimeType: 'text/plain', filename: '', body: { size: 10 } },
          { mimeType: 'multipart/related', parts: mail.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, body: { attachmentId: a.attachmentId, size: a.data.length } })) },
        ],
      },
    });
  });
  return { fetcher: fetcher as unknown as typeof fetch, requests };
}

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);
const messageOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.message);

describe('Gmail API calls', () => {
  it('searches for recent PDF attachments and reads their headers', async () => {
    const { fetcher, requests } = gmail();
    const candidates = await findCandidates('good-token', fetcher);
    expect(candidates).toEqual([
      { messageId: 'm1', subject: 'Your HbA1c lab report', from: 'Lakeside Diagnostics <reports@lakeside.example>', date: expect.stringMatching(/^2026-11-1[23]$/), attachmentName: 'HbA1c_report.pdf' },
      { messageId: 'm2', subject: 'Lipid profile result', from: 'reports@lakeside.example', date: expect.stringMatching(/^2026-11-(09|10)$/), attachmentName: 'lipid-profile.PDF' },
    ]);
    expect(requests[0].url).toBe(`/gmail/v1/users/me/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=${MAX_CANDIDATES}`);
    expect(SEARCH_QUERY).toContain('has:attachment filename:pdf newer_than:60d');
    expect(requests.every((r) => r.authorization === 'Bearer good-token')).toBe(true);
    // Read-only: every call is a GET to the Gmail API.
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.every(([, init]) => (init as RequestInit).method === undefined)).toBe(true);
  });

  it('handles an empty inbox and a message with no subject', async () => {
    expect(await findCandidates('good-token', gmail([]).fetcher)).toEqual([]);
    const bare = { ...INBOX[0], subject: '' };
    expect((await findCandidates('good-token', gmail([bare]).fetcher))[0].subject).toBe('(no subject)');
    const empty = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect(await findCandidates('good-token', empty)).toEqual([]);
  });

  it('downloads the first PDF of a message', async () => {
    const { candidate, file } = await downloadAttachment('good-token', 'm2', gmail().fetcher);
    expect(candidate.attachmentName).toBe('lipid-profile.PDF');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.4 lipid');
  });

  it('maps failures to ServiceError codes', async () => {
    const { fetcher } = gmail();
    expect(await messageOf(findCandidates('expired-token', fetcher))).toBe('The Gmail connection has expired. Please connect again.');
    expect(await codeOf(downloadAttachment('good-token', 'gone', fetcher))).toBe('not_found');
    expect(await codeOf(downloadAttachment('good-token', 'm3', fetcher))).toBe('not_found');
    const offline = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await codeOf(findCandidates('good-token', offline))).toBe('network');
    const busy = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    expect(await codeOf(findCandidates('good-token', busy))).toBe('network');

    const withData = (data: unknown) =>
      (async (input: RequestInfo | URL) =>
        String(input).includes('/attachments/') ? new Response(JSON.stringify({ data }), { status: 200 }) : gmail().fetcher(input, { headers: { authorization: 'Bearer good-token' } })) as unknown as typeof fetch;
    expect(await codeOf(downloadAttachment('good-token', 'm1', withData(undefined)))).toBe('unknown');
    expect(await codeOf(downloadAttachment('good-token', 'm1', withData('***not base64***')))).toBe('unknown');
  });
});

describe('token source', () => {
  type Callback = (response: Record<string, unknown>) => void;
  function google(answer: (config: { callback: Callback; error_callback?: (e: object) => void }) => void, granted = true) {
    const configs: Record<string, unknown>[] = [];
    return {
      configs,
      load: async () => ({
        initTokenClient: (config: never) => {
          configs.push(config);
          return { requestAccessToken: () => answer(config) };
        },
        hasGrantedAllScopes: () => granted,
      }),
    };
  }

  it('asks for read-only Gmail access and keeps the token in memory until it expires', async () => {
    let time = 1_000_000;
    const g = google((config) => config.callback({ access_token: 'good-token', expires_in: 3600, scope: GMAIL_SCOPE }));
    const source = createTokenSource({ clientId: 'client-id', load: g.load as never, now: () => time });
    expect(source.isConnected()).toBe(false);
    expect(() => source.token()).toThrow('Connect Gmail first.');
    await source.connect();
    expect(g.configs[0]).toMatchObject({ client_id: 'client-id', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    expect(source.token()).toBe('good-token');
    time += 3539_000;
    expect(source.isConnected()).toBe(true);
    time += 2_000;
    expect(source.isConnected()).toBe(false);
    expect(() => source.token()).toThrow('Connect Gmail first.');
  });

  it('disconnect forgets the token', async () => {
    const g = google((config) => config.callback({ access_token: 't' }));
    const source = createTokenSource({ clientId: 'client-id', load: g.load as never });
    await source.connect();
    expect(source.isConnected()).toBe(true);
    source.disconnect();
    expect(source.isConnected()).toBe(false);
  });

  it('rejects when consent is refused, the scope is not granted, or the window is closed', async () => {
    const make = (answer: Parameters<typeof google>[0], granted = true) =>
      createTokenSource({ clientId: 'client-id', load: google(answer, granted).load as never });
    const denied = make((config) => config.callback({ error: 'access_denied' }));
    expect(await messageOf(denied.connect())).toBe('Gmail was not connected. Nothing was read.');
    expect(denied.isConnected()).toBe(false);
    expect(await messageOf(make((config) => config.callback({ access_token: 't' }), false).connect())).toContain('Permission to read Gmail was not given');
    expect(await messageOf(make((config) => config.error_callback?.({ type: 'popup_closed' })).connect())).toContain('window was closed');
    expect(await messageOf(createTokenSource({ clientId: undefined }).connect())).toContain('VITE_GOOGLE_CLIENT_ID');
  });
});

describe('services.gmail', () => {
  let counter = 0;
  let db: CareVaultDb;
  let services: CareVaultServices;
  let api: ReturnType<typeof gmail>;
  let connected: boolean;
  const clock = new Date('2026-11-14T09:00:00+05:30');

  const tokenSource = (): TokenSource => ({
    connect: async () => { connected = true; },
    token: () => {
      if (!connected) throw Object.assign(new Error('Connect Gmail first.'), { code: 'unknown' });
      return 'good-token';
    },
    isConnected: () => connected,
    disconnect: () => { connected = false; },
  });

  beforeEach(async () => {
    counter += 1;
    connected = false;
    api = gmail();
    db = new CareVaultDb(`carevault-gmail-test-${counter}`);
    let n = 0;
    services = createRealServices({ db, now: () => clock, newId: () => `id-${(n += 1)}`, fetch: api.fetcher, gmailToken: tokenSource() });
    await services.profiles.loadSampleProfile();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('needs a connection before anything is read', async () => {
    expect(await messageOf(services.gmail.findCandidates())).toBe('Connect Gmail first.');
    expect(await messageOf(services.gmail.importAttachment(PROFILE, 'm1'))).toBe('Connect Gmail first.');
    expect(api.requests).toEqual([]);
  });

  it('imports an attachment as an unconfirmed document from email and opens a review item', async () => {
    await services.gmail.connect();
    expect((await services.gmail.findCandidates()).map((c) => c.messageId)).toEqual(['m1', 'm2']);

    const record = await services.gmail.importAttachment(PROFILE, 'm2');
    expect(record).toEqual({
      id: 'id-1',
      profileId: PROFILE,
      type: 'lab_report',
      title: 'lipid profile',
      documentDate: expect.stringMatching(/^2026-11-(09|10)$/),
      source: 'email',
      state: 'pending_confirmation',
      starred: false,
      prescriberId: null,
      mimeType: 'application/pdf',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      addedAt: clock.toISOString(),
    });
    expect(await (await services.documents.file(record.id)).text()).toBe('%PDF-1.4 lipid');

    const item = (await services.review.listOpen(PROFILE)).find((r) => r.documentId === record.id);
    expect(item).toMatchObject({
      kind: 'new_document',
      title: 'Add this lipid profile to his records?',
      body: expect.stringContaining('It looks like a lab report for Ramesh Iyer. Nothing is saved until you confirm.'),
    });

    // Once imported, the message is no longer offered.
    expect((await services.gmail.findCandidates()).map((c) => c.messageId)).toEqual(['m1']);
  });

  it('importing the same attachment twice keeps one document and one review item', async () => {
    await services.gmail.connect();
    const first = await services.gmail.importAttachment(PROFILE, 'm1');
    const again = await services.gmail.importAttachment(PROFILE, 'm1');
    expect(again).toEqual(first);
    expect((await services.documents.list(PROFILE)).filter((d) => d.sha256 === first.sha256)).toHaveLength(1);
    expect((await services.review.listOpen(PROFILE)).filter((r) => r.documentId === first.id)).toHaveLength(1);
  });

  it('"Add to records" confirms it and "Not his" removes it', async () => {
    await services.gmail.connect();
    const kept = await services.gmail.importAttachment(PROFILE, 'm1');
    const dropped = await services.gmail.importAttachment(PROFILE, 'm2');
    const open = await services.review.listOpen(PROFILE);
    await services.review.resolve(open.find((r) => r.documentId === kept.id)!.id, 'added');
    await services.review.resolve(open.find((r) => r.documentId === dropped.id)!.id, 'dismissed');
    expect((await services.documents.get(kept.id)).state).toBe('confirmed');
    expect(await codeOf(services.documents.get(dropped.id))).toBe('not_found');
    expect(await db.files.get(dropped.id)).toBeUndefined();
  });

  it('never stores the access token, and sends it only to Gmail', async () => {
    await services.gmail.connect();
    await services.gmail.findCandidates();
    await services.gmail.importAttachment(PROFILE, 'm1');
    const everything = JSON.stringify(await Promise.all(db.tables.filter((t) => t.name !== 'files').map((t) => t.toArray())));
    expect(everything).not.toContain('good-token');
    expect(api.requests.length).toBeGreaterThan(0);
    expect(api.requests.every((r) => r.url.startsWith('/gmail/v1/users/me/'))).toBe(true);
  });

  it('rejects an unknown profile or message and stores nothing', async () => {
    await services.gmail.connect();
    const before = await db.documents.count();
    expect(await codeOf(services.gmail.importAttachment('no-profile', 'm1'))).toBe('not_found');
    expect(await codeOf(services.gmail.importAttachment(PROFILE, 'gone'))).toBe('not_found');
    expect(await codeOf(services.gmail.importAttachment(PROFILE, 'm3'))).toBe('not_found');
    expect(await db.documents.count()).toBe(before);
    expect((await services.gmail.findCandidates()).map((c) => c.messageId)).toEqual(['m1', 'm2']);
  });
});
