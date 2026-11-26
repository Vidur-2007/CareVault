// Gmail REST calls, v2: read-only, from the browser, with the caregiver's short-lived token.
// One candidate per PDF attachment.
//
// Attachment identity: Gmail's own `attachmentId` is not stable (it can change each time the
// same message is fetched), so the `attachmentId` CareVault hands out is the attachment's
// `partId` within its message, which is stable. The current Gmail id is looked up from the
// message at download time.
import { ServiceError, type GmailCandidate } from '../../../contract/types';
import { fromBase64Url } from '../../share/crypto';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Messages from the last 60 days with a PDF attached that look like medical documents. */
export const SEARCH_QUERY = 'has:attachment filename:pdf newer_than:60d (report OR lab OR result OR prescription)';
export const MAX_MESSAGES = 20;

export const MESSAGES = {
  offline: 'Gmail could not be reached. Check the connection and try again.',
  expired: 'The Gmail connection has expired. Please connect again.',
  gone: 'This email is no longer in the inbox.',
  failed: 'Gmail did not answer. Please try again.',
  noAttachment: 'This attachment is no longer in that email.',
  empty: 'The attachment came back empty.',
  unreadable: 'The attachment could not be read.',
} as const;

type Fetcher = typeof fetch;

export interface Part {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: Part[];
}

export interface Message {
  id: string;
  internalDate?: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
}

async function get<T>(path: string, token: string, fetcher: Fetcher): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ServiceError('network', MESSAGES.offline);
  }
  if (response.status === 401) throw new ServiceError('unknown', MESSAGES.expired);
  if (response.status === 404) throw new ServiceError('not_found', MESSAGES.gone);
  if (!response.ok) throw new ServiceError('network', MESSAGES.failed);
  return (await response.json()) as T;
}

export interface PdfAttachment {
  /** Stable within the message: the part id, or Gmail's id when the part has none. */
  key: string;
  gmailId: string;
  filename: string;
}

/** Every PDF attached to a message, in the order they appear. */
export function pdfAttachments(part: Part | undefined): PdfAttachment[] {
  if (!part) return [];
  const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename ?? '');
  const own = part.filename && part.body?.attachmentId && isPdf
    ? [{ key: part.partId ?? part.body.attachmentId, gmailId: part.body.attachmentId, filename: part.filename }]
    : [];
  return [...own, ...(part.parts ?? []).flatMap(pdfAttachments)];
}

const header = (message: Message, name: string) =>
  message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

/** Candidates of one message, before `alreadyImported` is known. */
export function candidatesOf(message: Message): Omit<GmailCandidate, 'alreadyImported'>[] {
  const receivedAt = new Date(Number(message.internalDate ?? 0)).toISOString();
  return pdfAttachments(message.payload).map((a) => ({
    messageId: message.id,
    attachmentId: a.key,
    subject: header(message, 'subject') || '(no subject)',
    from: header(message, 'from'),
    receivedAt,
    attachmentName: a.filename,
  }));
}

const messagePath = (id: string) => `/messages/${encodeURIComponent(id)}?format=full`;

/** Recent PDF attachments, newest message first as Gmail returns them. */
export async function findCandidates(token: string, fetcher: Fetcher): Promise<Omit<GmailCandidate, 'alreadyImported'>[]> {
  const list = await get<{ messages?: { id: string }[] }>(
    `/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=${MAX_MESSAGES}`,
    token,
    fetcher,
  );
  const candidates: Omit<GmailCandidate, 'alreadyImported'>[] = [];
  for (const { id } of list.messages ?? []) candidates.push(...candidatesOf(await get<Message>(messagePath(id), token, fetcher)));
  return candidates;
}

export interface DownloadedAttachment {
  candidate: Omit<GmailCandidate, 'alreadyImported'>;
  file: Blob;
}

export async function downloadAttachment(token: string, messageId: string, attachmentId: string, fetcher: Fetcher): Promise<DownloadedAttachment> {
  const message = await get<Message>(messagePath(messageId), token, fetcher);
  const candidate = candidatesOf(message).find((c) => c.attachmentId === attachmentId);
  const part = pdfAttachments(message.payload).find((a) => a.key === attachmentId);
  if (!candidate || !part) throw new ServiceError('not_found', MESSAGES.noAttachment);
  const attachment = await get<{ data?: string }>(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.gmailId)}`,
    token,
    fetcher,
  );
  if (!attachment.data) throw new ServiceError('unknown', MESSAGES.empty);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64Url(attachment.data.replace(/=+$/, ''));
  } catch {
    throw new ServiceError('unknown', MESSAGES.unreadable);
  }
  return { candidate, file: new Blob([bytes], { type: 'application/pdf' }) };
}
