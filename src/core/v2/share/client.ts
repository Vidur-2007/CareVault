// Shared passports, v2 (overview 9.7). The snapshot is encrypted on the device as
// { v: 2, snapshot }; only ciphertext reaches /api/share, and the key stays in the link's
// fragment. Links made by v1 hold a bare v1 passport; they still open, wrapped as a snapshot.
// Error messages are written for the caregiver: no status codes in the text.
import { z } from 'zod';
import type * as L from '../../../contract/legacy/types';
import { ServiceError, type ISODateTime, type Passport, type PassportSnapshot } from '../../../contract/types';
import { decryptJson, encryptJson, type Sealed } from '../../share/crypto';

type Fetcher = typeof fetch;

export const PAYLOAD_VERSION = 2;

export const MESSAGES = {
  offline: 'The server could not be reached. Check the connection and try again.',
  notConfigured: 'Sharing is not set up on this server yet.',
  tooLarge: 'This passport is too large to share.',
  createFailed: 'The link could not be created. Please try again.',
  unreadable: 'The server returned something unreadable. Please try again.',
  notFound: 'This link does not exist.',
  revoked: 'This link was revoked.',
  expired: 'This link has expired.',
  loadFailed: 'The passport could not be loaded. Please try again.',
  wrongKey: 'This link could not be opened. The key in the link is missing or wrong.',
  notPassport: 'This link does not hold a readable passport.',
  revokeFailed: 'The link could not be revoked. Please try again.',
} as const;

async function call(fetcher: Fetcher, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetcher(path, init);
  } catch {
    throw new ServiceError('network', MESSAGES.offline);
  }
}

const created = z.object({ id: z.string().min(1), revokeToken: z.string().min(1), expiresAt: z.string().optional() });
const fetched = z.object({ ciphertext: z.string().min(1), iv: z.string().min(1) });

const isoDate = z.string();
const snapshotDocument = z.object({
  documentId: z.string(), title: z.string(), kind: z.string(), clinicalDate: isoDate.nullable(), sha256: z.string(), removedAt: z.string().nullable(),
});
const passportSchema = z.object({
  profileId: z.string(),
  patientName: z.string(),
  patientAge: z.number().nullable(),
  emergencyContact: z.string().nullable(),
  preparedBy: z.string(),
  preparedOn: isoDate,
  visit: z.object({ at: z.string(), prescriberName: z.string(), specialty: z.string() }).nullable(),
  currentMedicines: z.array(z.object({
    productName: z.string(), ingredientsText: z.string(), instruction: z.string(), prescriberName: z.string().nullable(),
    source: z.string(), lastConfirmedOn: isoDate.nullable(),
  })),
  unconfirmed: z.array(z.object({ productName: z.string(), reason: z.string() })),
  allergies: z.object({ state: z.enum(['listed', 'none_known', 'not_recorded']), items: z.array(z.string()) }),
  conditions: z.array(z.string()),
  procedures: z.array(z.string()),
  recentChanges: z.array(z.object({ kind: z.enum(['started', 'changed', 'stopped', 'not_started']), text: z.string(), on: isoDate })),
  flags: z.array(z.string()),
  documents: z.array(snapshotDocument),
  questions: z.array(z.string()),
});
const snapshotSchema = z.object({
  id: z.string(), profileId: z.string(), createdAt: z.string(), reason: z.enum(['manual', 'print', 'share']), passport: passportSchema, revision: z.number(),
});
const payloadV2 = z.object({ v: z.literal(PAYLOAD_VERSION), snapshot: snapshotSchema });

/** What a v1 link holds. */
const passportV1: z.ZodType<L.Passport> = z.object({
  patientName: z.string(),
  patientAge: z.number().nullable(),
  preparedBy: z.string(),
  preparedOn: z.string(),
  visitAt: z.string().nullable(),
  prescriberName: z.string().nullable(),
  prescriberSpecialty: z.string().nullable(),
  currentMedicines: z.array(z.object({ productName: z.string(), instruction: z.string(), prescriberName: z.string().nullable() })),
  changesSince: z.string().nullable(),
  changes: z.array(z.object({ kind: z.enum(['added', 'changed', 'unconfirmed']), text: z.string() })),
  flags: z.array(z.string()),
  documents: z.array(z.object({ title: z.string(), documentDate: z.string() })),
  questions: z.array(z.string()),
});

/**
 * A v1 passport shown as a v2 snapshot. What v1 did not record stays empty or unknown:
 * no profile, no allergies section ("not recorded"), no document hashes.
 */
export function wrapV1Passport(passport: L.Passport, linkId: string): PassportSnapshot {
  const v2: Passport = {
    profileId: '',
    patientName: passport.patientName,
    patientAge: passport.patientAge,
    emergencyContact: null,
    preparedBy: passport.preparedBy,
    preparedOn: passport.preparedOn,
    visit: passport.visitAt ? { at: passport.visitAt, prescriberName: passport.prescriberName ?? '', specialty: passport.prescriberSpecialty ?? '' } : null,
    currentMedicines: passport.currentMedicines.map((m) => ({
      productName: m.productName, ingredientsText: '', instruction: m.instruction, prescriberName: m.prescriberName, source: 'legacy', lastConfirmedOn: null,
    })),
    unconfirmed: passport.changes.filter((c) => c.kind === 'unconfirmed').map((c) => ({ productName: c.text, reason: 'Not confirmed' })),
    allergies: { state: 'not_recorded', items: [] },
    conditions: [],
    procedures: [],
    recentChanges: passport.changes
      .filter((c) => c.kind !== 'unconfirmed')
      .map((c) => ({ kind: c.kind === 'added' ? ('started' as const) : ('changed' as const), text: c.text, on: passport.changesSince ?? passport.preparedOn })),
    flags: passport.flags,
    documents: passport.documents.map((d) => ({ documentId: '', title: d.title, kind: 'other', clinicalDate: d.documentDate || null, sha256: '', removedAt: null })),
    questions: passport.questions,
  };
  return { id: linkId, profileId: '', createdAt: `${passport.preparedOn}T00:00:00.000Z`, reason: 'share', passport: v2, revision: 0 };
}

export interface CreatedShare {
  id: string;
  key: string;
  revokeToken: string;
  expiresAt: ISODateTime;
}

export async function uploadSnapshot(snapshot: PassportSnapshot, expiresAt: ISODateTime, fetcher: Fetcher): Promise<CreatedShare> {
  const { key, ...sealed } = await encryptJson({ v: PAYLOAD_VERSION, snapshot });
  const response = await call(fetcher, '/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sealed, expiresAt }),
  });
  if (response.status === 503) throw new ServiceError('not_configured', MESSAGES.notConfigured);
  if (response.status === 413) throw new ServiceError('unknown', MESSAGES.tooLarge);
  if (!response.ok) throw new ServiceError('network', MESSAGES.createFailed);
  const body = created.safeParse(await response.json().catch(() => null));
  if (!body.success) throw new ServiceError('unknown', MESSAGES.unreadable);
  return { id: body.data.id, key, revokeToken: body.data.revokeToken, expiresAt: body.data.expiresAt ?? expiresAt };
}

export async function downloadSnapshot(id: string, key: string, fetcher: Fetcher): Promise<PassportSnapshot> {
  const response = await call(fetcher, `/api/share/${encodeURIComponent(id)}`);
  if (response.status === 404) throw new ServiceError('not_found', MESSAGES.notFound);
  if (response.status === 410) {
    const reason = ((await response.json().catch(() => null)) as { reason?: string } | null)?.reason;
    if (reason === 'revoked') throw new ServiceError('revoked', MESSAGES.revoked);
    throw new ServiceError('expired', MESSAGES.expired);
  }
  if (response.status === 503) throw new ServiceError('not_configured', MESSAGES.notConfigured);
  if (!response.ok) throw new ServiceError('network', MESSAGES.loadFailed);
  const sealed = fetched.safeParse(await response.json().catch(() => null));
  if (!sealed.success) throw new ServiceError('unknown', MESSAGES.unreadable);

  let data: unknown;
  try {
    data = await decryptJson(sealed.data as Sealed, key);
  } catch {
    throw new ServiceError('unknown', MESSAGES.wrongKey);
  }
  const v2 = payloadV2.safeParse(data);
  if (v2.success) return v2.data.snapshot as PassportSnapshot;
  const v1 = passportV1.safeParse(data);
  if (v1.success) return wrapV1Passport(v1.data, id);
  throw new ServiceError('unknown', MESSAGES.notPassport);
}

export async function revokeLink(id: string, revokeToken: string, fetcher: Fetcher): Promise<void> {
  const response = await call(fetcher, `/api/share/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-revoke-token': revokeToken },
  });
  // 404: the server no longer has it, so there is nothing left to revoke.
  if (response.ok || response.status === 404) return;
  if (response.status === 503) throw new ServiceError('not_configured', MESSAGES.notConfigured);
  throw new ServiceError('network', MESSAGES.revokeFailed);
}
