// Gmail REST calls, made from the browser with the caregiver's short-lived token.
// Read-only: search for messages with PDF attachments, read their headers, download one.
import { ServiceError, type GmailCandidate, type ISODate } from '../../contract/legacy/types';
import { fromBase64Url } from '../share/crypto';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Messages from the last 60 days with a PDF attached that look like medical documents. */
export const SEARCH_QUERY = 'has:attachment filename:pdf newer_than:60d (report OR lab OR result OR prescription)';
export const MAX_CANDIDATES = 20;

type Fetcher = typeof fetch;

interface Part {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: Part[];
}

interface Message {
  id: string;
  internalDate?: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
}

async function get<T>(path: string, token: string, fetcher: Fetcher): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ServiceError('network', 'Gmail could not be reached. Check the connection and try again.');
  }
  if (response.status === 401) throw new ServiceError('unknown', 'The Gmail connection has expired. Please connect again.');
  if (response.status === 404) throw new ServiceError('not_found', 'This email is no longer in the inbox.');
  if (!response.ok) throw new ServiceError('network', `Gmail did not answer (${response.status}). Please try again.`);
  return (await response.json()) as T;
}

function pdfParts(part: Part | undefined): Part[] {
  if (!part) return [];
  const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename ?? '');
  const own = part.filename && part.body?.attachmentId && isPdf ? [part] : [];
  return [...own, ...(part.parts ?? []).flatMap(pdfParts)];
}

const header = (message: Message, name: string) =>
  message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

/** The day the message arrived, in the device's time zone. */
function dateOf(message: Message): ISODate {
  const date = new Date(Number(message.internalDate ?? 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toCandidate(message: Message): GmailCandidate | null {
  const attachment = pdfParts(message.payload)[0];
  if (!attachment) return null;
  return {
    messageId: message.id,
    subject: header(message, 'subject') || '(no subject)',
    from: header(message, 'from'),
    date: dateOf(message),
    attachmentName: attachment.filename!,
  };
}

/** Recent messages that carry a PDF, newest first as Gmail returns them. */
export async function findCandidates(token: string, fetcher: Fetcher): Promise<GmailCandidate[]> {
  const list = await get<{ messages?: { id: string }[] }>(
    `/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=${MAX_CANDIDATES}`,
    token,
    fetcher,
  );
  const candidates: GmailCandidate[] = [];
  for (const { id } of list.messages ?? []) {
    const candidate = toCandidate(await get<Message>(`/messages/${encodeURIComponent(id)}?format=full`, token, fetcher));
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export interface DownloadedAttachment {
  candidate: GmailCandidate;
  file: Blob;
}

/** The first PDF attached to a message. */
export async function downloadAttachment(token: string, messageId: string, fetcher: Fetcher): Promise<DownloadedAttachment> {
  const message = await get<Message>(`/messages/${encodeURIComponent(messageId)}?format=full`, token, fetcher);
  const candidate = toCandidate(message);
  const part = pdfParts(message.payload)[0];
  if (!candidate || !part) throw new ServiceError('not_found', 'This email has no PDF attached.');
  const attachment = await get<{ data?: string }>(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body!.attachmentId!)}`,
    token,
    fetcher,
  );
  if (!attachment.data) throw new ServiceError('unknown', 'The attachment came back empty.');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64Url(attachment.data.replace(/=+$/, ''));
  } catch {
    throw new ServiceError('unknown', 'The attachment could not be read.');
  }
  return { candidate, file: new Blob([bytes], { type: 'application/pdf' }) };
}
