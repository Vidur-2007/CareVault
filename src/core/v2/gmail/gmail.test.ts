// @vitest-environment node
// Gmail v2 through the services, against a stand-in for the Gmail REST API (mocked fetch).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../../contract/services';
import type { ServiceError } from '../../../contract/types';
import type { TokenSource } from '../../gmail/token';
import { toBase64Url } from '../../share/crypto';
import { createRealServicesV2 } from '../createRealServicesV2';
import { CareVaultDbV2 } from '../db/schema';
import { candidatesOf, MESSAGES, pdfAttachments } from './api';

const pdfBytes = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

interface Mail {
  id: string;
  subject: string;
  from: string;
  internalDate: string;
  attachments: { partId: string; filename: string; mimeType: string; data: Uint8Array }[];
}

const HBA1C = 'Lakeside Diagnostics\nPatient: Ramesh Iyer\nHbA1c 7.1 %';
const LIPID = 'Lakeside Diagnostics\nPatient: Ramesh Iyer\nLipid profile\nTotal cholesterol 182 mg/dL';
const THYROID = 'Lakeside Diagnostics\nPatient: Lakshmi Iyer\nThyroid profile TSH 2.1';

const INBOX: Mail[] = [
  {
    id: 'm1', subject: 'Your reports', from: 'Lakeside Diagnostics <reports@lakeside.example>',
    internalDate: String(Date.parse('2026-11-12T14:35:00Z')),
    attachments: [
      { partId: '1.0', filename: 'logo.png', mimeType: 'image/png', data: new Uint8Array([1]) },
      { partId: '1.1', filename: 'HbA1c_report.pdf', mimeType: 'application/pdf', data: pdfBytes(HBA1C) },
      { partId: '1.2', filename: 'lipid-profile.PDF', mimeType: 'application/octet-stream', data: pdfBytes(LIPID) },
    ],
  },
  {
    id: 'm2', subject: 'Thyroid result', from: 'reports@lakeside.example',
    internalDate: String(Date.parse('2026-11-10T09:00:00Z')),
    attachments: [{ partId: '1', filename: 'thyroid.pdf', mimeType: 'application/pdf', data: pdfBytes(THYROID) }],
  },
  { id: 'm3', subject: '', from: 'someone@example.com', internalDate: '0', attachments: [] },
];

/** A stand-in for the Gmail API. Like the real one, it gives a new attachment id on every fetch. */
function gmail(inbox: Mail[] = INBOX) {
  let fetches = 0;
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
      const partId = attachment[2].split('~')[1];
      const found = inbox.find((m) => m.id === attachment[1])?.attachments.find((a) => a.partId === partId);
      return found ? json({ size: found.data.length, data: toBase64Url(found.data) }) : new Response('{}', { status: 404 });
    }
    const message = path.match(/^\/messages\/([^/]+)$/);
    const mail = message && inbox.find((m) => m.id === message[1]);
    if (!mail) return new Response('{}', { status: 404 });
    fetches += 1;
    return json({
      id: mail.id,
      internalDate: mail.internalDate,
      payload: {
        partId: '', mimeType: 'multipart/mixed',
        headers: [{ name: 'Subject', value: mail.subject }, { name: 'From', value: mail.from }],
        parts: [
          { partId: '0', mimeType: 'text/plain', filename: '', body: { size: 10 } },
          {
            partId: '1', mimeType: 'multipart/related',
            parts: mail.attachments.map((a) => ({ partId: a.partId, filename: a.filename, mimeType: a.mimeType, body: { attachmentId: `fetch${fetches}~${a.partId}`, size: a.data.length } })),
          },
        ],
      },
    });
  });
  return { fetcher: fetcher as unknown as typeof fetch, requests };
}

function fakeToken(): TokenSource & { expire(): void } {
  let state: 'none' | 'ok' | 'expired' = 'none';
  return {
    connect: async () => {
      state = 'ok';
    },
    token: () => {
      if (state !== 'ok') throw new Error('no token');
      return 'good-token';
    },
    isConnected: () => state === 'ok',
    disconnect: () => {
      state = 'none';
    },
    expire: () => {
      state = 'expired';
    },
  };
}

let counter = 0;
let db: CareVaultDbV2;
let services: CareVaultServices;
let token: ReturnType<typeof fakeToken>;
let api: ReturnType<typeof gmail>;

const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.code);
const messageOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (e: ServiceError) => e.message);

function make(fetcher: typeof fetch, tokens: TokenSource = token) {
  let ms = Date.parse('2026-11-14T09:00:00+05:30');
  return createRealServicesV2({
    db,
    now: () => new Date((ms += 1000)),
    fetch: fetcher,
    gmailToken: tokens,
    reading: {
      // The test PDFs carry their text after the header, one line per line.
      pdfPages: async (file) => ({ pageCount: 1, pages: [(await file.text()).replace('%PDF-1.4 ', '')] }),
      renderPdfPage: async () => {
        throw new Error('no OCR in this test');
      },
      engines: async () => [],
      cloud: async () => {
        throw new Error('no cloud in this test');
      },
    },
  });
}

beforeEach(async () => {
  db = new CareVaultDbV2(`gmail-v2-test-${(counter += 1)}`);
  token = fakeToken();
  api = gmail();
  services = make(api.fetcher);
  await services.profiles.loadSampleProfile();
  await services.gmail.connect();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('candidates', () => {
  it('one row per PDF attachment: two PDFs in one email are two rows; images are not offered', async () => {
    const candidates = await services.gmail.findCandidates(IDS.ramesh);
    expect(candidates).toEqual([
      { messageId: 'm1', attachmentId: '1.1', subject: 'Your reports', from: 'Lakeside Diagnostics <reports@lakeside.example>', receivedAt: '2026-11-12T14:35:00.000Z', attachmentName: 'HbA1c_report.pdf', alreadyImported: false },
      { messageId: 'm1', attachmentId: '1.2', subject: 'Your reports', from: 'Lakeside Diagnostics <reports@lakeside.example>', receivedAt: '2026-11-12T14:35:00.000Z', attachmentName: 'lipid-profile.PDF', alreadyImported: false },
      { messageId: 'm2', attachmentId: '1', subject: 'Thyroid result', from: 'reports@lakeside.example', receivedAt: '2026-11-10T09:00:00.000Z', attachmentName: 'thyroid.pdf', alreadyImported: false },
    ]);
    // Read-only search, with the token sent only to Gmail.
    expect(api.requests[0].url).toContain('/gmail/v1/users/me/messages?q=');
    expect(api.requests.every((r) => r.authorization === 'Bearer good-token')).toBe(true);
  });

  it('a message with no subject, and parts without a part id', () => {
    const message = { id: 'x', payload: { headers: [], parts: [{ filename: 'a.pdf', mimeType: 'application/pdf', body: { attachmentId: 'g1' } }] } };
    expect(candidatesOf(message)).toEqual([{ messageId: 'x', attachmentId: 'g1', subject: '(no subject)', from: '', receivedAt: '1970-01-01T00:00:00.000Z', attachmentName: 'a.pdf' }]);
    expect(pdfAttachments(undefined)).toEqual([]);
  });
});

describe('importing', () => {
  it('both PDFs of one email import separately, as email records with the time they arrived, then are read', async () => {
    const hba1c = await services.gmail.importAttachment(IDS.ramesh, 'm1', '1.1');
    const lipid = await services.gmail.importAttachment(IDS.ramesh, 'm1', '1.2');
    expect(hba1c.record.id).not.toBe(lipid.record.id);
    expect(hba1c).toMatchObject({
      duplicate: null,
      record: {
        source: 'email', title: 'HbA1c report', receivedAt: '2026-11-12T14:35:00.000Z', clinicalDate: null, dateSource: 'unknown',
        state: 'pending_review', patientNameRead: 'Ramesh Iyer', patientMatch: 'match', pageCount: 1, pagesRead: 1, mimeType: 'application/pdf',
      },
    });
    expect(lipid.record.title).toBe('lipid profile');
    expect((await services.gmail.findCandidates(IDS.ramesh)).filter((c) => c.messageId === 'm1').map((c) => c.alreadyImported)).toEqual([true, true]);
    // The original is kept.
    expect(await (await services.documents.file(hba1c.record.id)).blob.text()).toBe(`%PDF-1.4 ${HBA1C}`);
  });

  it('importing for one profile does not hide the message from another', async () => {
    await services.gmail.importAttachment(IDS.ramesh, 'm1', '1.1');
    expect((await services.gmail.findCandidates(IDS.ramesh))[0].alreadyImported).toBe(true);
    expect((await services.gmail.findCandidates(IDS.lakshmi))[0].alreadyImported).toBe(false);
    const forLakshmi = await services.gmail.importAttachment(IDS.lakshmi, 'm1', '1.1');
    expect(forLakshmi.record.profileId).toBe(IDS.lakshmi);
    // Another profile's copy is not a duplicate.
    expect(forLakshmi.duplicate).toBeNull();
    expect((await services.gmail.findCandidates(IDS.lakshmi))[0].alreadyImported).toBe(true);
  });

  it('the same attachment twice for one profile stays one record', async () => {
    const first = await services.gmail.importAttachment(IDS.ramesh, 'm2', '1');
    const again = await services.gmail.importAttachment(IDS.ramesh, 'm2', '1');
    expect(again).toEqual({ record: first.record, duplicate: null });
    expect((await services.documents.list(IDS.ramesh)).filter((d) => d.source === 'email' && d.title === 'thyroid')).toHaveLength(1);
    // Once the record is removed, the attachment can be imported again.
    await services.documents.remove(first.record.id);
    expect((await services.gmail.findCandidates(IDS.ramesh)).find((c) => c.messageId === 'm2')!.alreadyImported).toBe(false);
    expect((await services.gmail.importAttachment(IDS.ramesh, 'm2', '1')).record.id).not.toBe(first.record.id);
  });

  it('a file uploaded first and then imported by email is reported as a duplicate', async () => {
    const uploaded = await services.documents.add(IDS.ramesh, new Blob([pdfBytes(LIPID)], { type: 'application/pdf' }), { source: 'upload', title: 'Lipid' });
    const imported = await services.gmail.importAttachment(IDS.ramesh, 'm1', '1.2');
    expect(imported.duplicate).toMatchObject({ existingId: uploaded.record.id, existingTitle: 'Lipid', exact: true });
  });

  it('a different patient name becomes an unassigned import in attention, until it is assigned', async () => {
    const { record } = await services.gmail.importAttachment(IDS.ramesh, 'm2', '1');
    expect(record).toMatchObject({ patientNameRead: 'Lakshmi Iyer', patientMatch: 'mismatch', state: 'pending_review' });
    const item = (await services.attention.list(IDS.ramesh)).find((i) => i.kind === 'unassigned_import');
    expect(item).toMatchObject({ id: `unassigned_import:${record.id}`, documentId: record.id });
    await services.documents.assignProfile(record.id, IDS.lakshmi);
    expect((await services.attention.list(IDS.ramesh)).some((i) => i.kind === 'unassigned_import')).toBe(false);
  });

  it('a reading that fails keeps the record', async () => {
    const broken: Mail = { id: 'm9', subject: 'Scan', from: 'x', internalDate: '1', attachments: [{ partId: '1', filename: 'scan.pdf', mimeType: 'application/pdf', data: pdfBytes('') }] };
    const withBroken = gmail([broken]);
    const svc = make(withBroken.fetcher);
    await svc.gmail.connect();
    const { record } = await svc.gmail.importAttachment(IDS.ramesh, 'm9', '1');
    expect(record).toMatchObject({ source: 'email', patientMatch: 'not_found' });
    expect(await svc.documents.get(record.id)).toEqual(record);
  });

  it('an empty inbox, and an attachment that comes back empty', async () => {
    const emptyInbox = make((async () => new Response('{}', { status: 200 })) as unknown as typeof fetch);
    await emptyInbox.gmail.connect();
    expect(await emptyInbox.gmail.findCandidates(IDS.ramesh)).toEqual([]);
    const blank = make(gmail([{ id: 'm8', subject: 'Blank', from: 'x', internalDate: '1', attachments: [{ partId: '1', filename: 'blank.pdf', mimeType: 'application/pdf', data: new Uint8Array() }] }]).fetcher);
    await blank.gmail.connect();
    expect(await messageOf(blank.gmail.importAttachment(IDS.ramesh, 'm8', '1'))).toBe(MESSAGES.empty);
  });

  it('refuses an unknown profile, message or attachment, and stores nothing', async () => {
    const before = await db.documents.count();
    expect(await codeOf(services.gmail.importAttachment('nope', 'm1', '1.1'))).toBe('not_found');
    expect(await messageOf(services.gmail.importAttachment(IDS.ramesh, 'nope', '1.1'))).toBe(MESSAGES.gone);
    expect(await messageOf(services.gmail.importAttachment(IDS.ramesh, 'm1', '1.0'))).toBe(MESSAGES.noAttachment);
    expect(await codeOf(services.gmail.findCandidates('nope'))).toBe('not_found');
    expect(await db.documents.count()).toBe(before);
    expect(await db.gmailImports.count()).toBe(0);
  });
});

describe('the connection', () => {
  it('asks to connect first, then says when the connection has expired', async () => {
    const fresh = make(api.fetcher, fakeToken());
    expect(await messageOf(fresh.gmail.findCandidates(IDS.ramesh))).toBe('Connect Gmail first.');
    token.expire();
    expect(await messageOf(services.gmail.findCandidates(IDS.ramesh))).toBe(MESSAGES.expired);
    expect(await messageOf(services.gmail.importAttachment(IDS.ramesh, 'm1', '1.1'))).toBe(MESSAGES.expired);
  });

  it('a token Gmail no longer accepts gives the same message', async () => {
    const stale = make(api.fetcher, { ...fakeToken(), token: () => 'old-token', connect: async () => undefined });
    await stale.gmail.connect();
    expect(await messageOf(stale.gmail.findCandidates(IDS.ramesh))).toBe(MESSAGES.expired);
  });

  it('a copy with no Google client id: not_configured', async () => {
    const off = make(api.fetcher, { ...fakeToken(), connect: async () => { throw new Error('Gmail import is not set up: VITE_GOOGLE_CLIENT_ID is missing.'); } });
    const error = await off.gmail.connect().catch((e: ServiceError) => e);
    expect(error).toMatchObject({ code: 'not_configured', message: 'Gmail import is not set up on this copy.' });
    const refused = make(api.fetcher, { ...fakeToken(), connect: async () => { throw new Error('Gmail was not connected. Nothing was read.'); } });
    expect(await refused.gmail.connect().catch((e: ServiceError) => [e.code, e.message])).toEqual(['unknown', 'Gmail was not connected. Nothing was read.']);
    const silent = make(api.fetcher, { ...fakeToken(), connect: async () => { throw new Error(''); } });
    expect(await messageOf(silent.gmail.connect())).toBe('Gmail was not connected. Nothing was read.');
  });

  it('offline, and Gmail failing: messages without status codes', async () => {
    const offline = make((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
    await offline.gmail.connect();
    expect(await codeOf(offline.gmail.findCandidates(IDS.ramesh))).toBe('network');
    const down = make((async () => new Response('{}', { status: 500 })) as typeof fetch);
    await down.gmail.connect();
    expect(await messageOf(down.gmail.findCandidates(IDS.ramesh))).toBe(MESSAGES.failed);
    for (const message of Object.values(MESSAGES)) expect(message).not.toMatch(/\d{3}/);
  });

  it('never stores the access token', async () => {
    await services.gmail.importAttachment(IDS.ramesh, 'm1', '1.1');
    const everything = JSON.stringify(await Promise.all(db.tables.filter((t) => t.name !== 'files').map((t) => t.toArray())));
    expect(everything).not.toContain('good-token');
  });
});
