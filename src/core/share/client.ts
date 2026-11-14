// Calls to /api/share, and the checks on what comes back.
import { z } from 'zod';
import { ServiceError, type ISODateTime, type Passport } from '../../contract/types';
import { decryptJson, encryptJson, type Sealed } from './crypto';

type Fetcher = typeof fetch;

async function call(fetcher: Fetcher, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetcher(path, init);
  } catch {
    throw new ServiceError('network', 'The server could not be reached. Check the connection and try again.');
  }
}

const created = z.object({ id: z.string().min(1), revokeToken: z.string().min(1), expiresAt: z.string().optional() });
const fetched = z.object({ ciphertext: z.string().min(1), iv: z.string().min(1) });

const passportSchema: z.ZodType<Passport> = z.object({
  patientName: z.string(),
  patientAge: z.number().nullable(),
  preparedBy: z.string(),
  preparedOn: z.string(),
  visitAt: z.string().nullable(),
  prescriberName: z.string().nullable(),
  prescriberSpecialty: z.string().nullable(),
  currentMedicines: z.array(
    z.object({ productName: z.string(), instruction: z.string(), prescriberName: z.string().nullable() }),
  ),
  changesSince: z.string().nullable(),
  changes: z.array(z.object({ kind: z.enum(['added', 'changed', 'unconfirmed']), text: z.string() })),
  flags: z.array(z.string()),
  documents: z.array(z.object({ title: z.string(), documentDate: z.string() })),
  questions: z.array(z.string()),
});

export interface CreatedShare {
  id: string;
  key: string;
  revokeToken: string;
  expiresAt: ISODateTime;
}

/** Encrypts the passport here, then uploads only the ciphertext. */
export async function uploadPassport(passport: Passport, expiresAt: ISODateTime, fetcher: Fetcher): Promise<CreatedShare> {
  const { key, ...sealed } = await encryptJson(passport);
  const response = await call(fetcher, '/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sealed, expiresAt }),
  });
  if (response.status === 413) throw new ServiceError('unknown', 'This passport is too large to share.');
  if (!response.ok) throw new ServiceError('network', `The link could not be created (${response.status}). Please try again.`);
  const body = created.safeParse(await response.json().catch(() => null));
  if (!body.success) throw new ServiceError('unknown', 'The server returned something unreadable.');
  return { id: body.data.id, key, revokeToken: body.data.revokeToken, expiresAt: body.data.expiresAt ?? expiresAt };
}

/** Fetches the ciphertext and decrypts it with the key from the link. */
export async function downloadPassport(id: string, key: string, fetcher: Fetcher): Promise<Passport> {
  const response = await call(fetcher, `/api/share/${encodeURIComponent(id)}`);
  if (response.status === 404) throw new ServiceError('not_found', 'This link does not exist.');
  if (response.status === 410) {
    const reason = ((await response.json().catch(() => null)) as { reason?: string } | null)?.reason;
    if (reason === 'revoked') throw new ServiceError('revoked', 'This link was revoked.');
    throw new ServiceError('expired', 'This link has expired.');
  }
  if (!response.ok) throw new ServiceError('network', `The passport could not be loaded (${response.status}). Please try again.`);
  const sealed = fetched.safeParse(await response.json().catch(() => null));
  if (!sealed.success) throw new ServiceError('unknown', 'The server returned something unreadable.');

  let data: unknown;
  try {
    data = await decryptJson(sealed.data as Sealed, key);
  } catch {
    throw new ServiceError('unknown', 'This link could not be opened. The key in the link is missing or wrong.');
  }
  const passport = passportSchema.safeParse(data);
  if (!passport.success) throw new ServiceError('unknown', 'This link does not hold a readable passport.');
  return passport.data;
}

export async function revokeShare(id: string, revokeToken: string, fetcher: Fetcher): Promise<void> {
  const response = await call(fetcher, `/api/share/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-revoke-token': revokeToken },
  });
  // 404: the server no longer has it, so there is nothing left to revoke.
  if (response.ok || response.status === 404) return;
  throw new ServiceError('network', `The link could not be revoked (${response.status}). Please try again.`);
}
