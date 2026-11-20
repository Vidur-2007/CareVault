// The v2 share client against a faked server: every status it can meet.
import { describe, expect, it } from 'vitest';
import type { Passport as PassportV1 } from '../../../contract/legacy/types';
import type { PassportSnapshot, ServiceError } from '../../../contract/types';
import { encryptJson } from '../../share/crypto';
import { downloadSnapshot, MESSAGES, revokeLink, uploadSnapshot, wrapV1Passport } from './client';

const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const fail = (promise: Promise<unknown>) => promise.then(() => null, (e: ServiceError) => [e.code, e.message]);
const snapshot = { id: 's', profileId: 'p', createdAt: '2026-11-14T10:00:00Z', reason: 'share', revision: 1, passport: {} } as unknown as PassportSnapshot;

describe('upload', () => {
  it('maps each failure to a caregiver message', async () => {
    expect(await fail(uploadSnapshot(snapshot, 'x', reply(503)))).toEqual(['not_configured', MESSAGES.notConfigured]);
    expect(await fail(uploadSnapshot(snapshot, 'x', reply(413)))).toEqual(['unknown', MESSAGES.tooLarge]);
    expect(await fail(uploadSnapshot(snapshot, 'x', reply(500)))).toEqual(['network', MESSAGES.createFailed]);
    expect(await fail(uploadSnapshot(snapshot, 'x', reply(201, { id: '' })))).toEqual(['unknown', MESSAGES.unreadable]);
  });

  it('keeps the requested expiry when the server does not say', async () => {
    expect(await uploadSnapshot(snapshot, '2026-11-15T00:00:00Z', reply(201, { id: 'i', revokeToken: 't' }))).toMatchObject({ id: 'i', expiresAt: '2026-11-15T00:00:00Z' });
  });
});

describe('download', () => {
  it('maps each failure to a caregiver message', async () => {
    expect(await fail(downloadSnapshot('i', 'k', reply(410, {})))).toEqual(['expired', MESSAGES.expired]);
    expect(await fail(downloadSnapshot('i', 'k', async () => new Response('not json', { status: 410 })))).toEqual(['expired', MESSAGES.expired]);
    expect(await fail(downloadSnapshot('i', 'k', reply(503)))).toEqual(['not_configured', MESSAGES.notConfigured]);
    expect(await fail(downloadSnapshot('i', 'k', reply(500)))).toEqual(['network', MESSAGES.loadFailed]);
    expect(await fail(downloadSnapshot('i', 'k', reply(200, { ciphertext: '' })))).toEqual(['unknown', MESSAGES.unreadable]);
  });

  it('opens a v2 payload', async () => {
    const real: PassportSnapshot = wrapV1Passport({
      patientName: 'A', patientAge: null, preparedBy: 'A', preparedOn: '2026-01-01', visitAt: null, prescriberName: null, prescriberSpecialty: null,
      currentMedicines: [], changesSince: null, changes: [], flags: [], documents: [], questions: [],
    }, 'x');
    const { key, ...sealed } = await encryptJson({ v: 2, snapshot: { ...real, profileId: 'p', reason: 'print', revision: 3 } });
    expect(await downloadSnapshot('i', key, reply(200, sealed))).toMatchObject({ profileId: 'p', reason: 'print', revision: 3 });
  });
});

describe('revoke', () => {
  it('a link the server no longer has is already revoked; other failures are reported', async () => {
    await expect(revokeLink('i', 't', reply(404))).resolves.toBeUndefined();
    await expect(revokeLink('i', 't', reply(200))).resolves.toBeUndefined();
    expect(await fail(revokeLink('i', 't', reply(503)))).toEqual(['not_configured', MESSAGES.notConfigured]);
    expect(await fail(revokeLink('i', 't', reply(403)))).toEqual(['network', MESSAGES.revokeFailed]);
  });
});

describe('a v1 passport as a snapshot', () => {
  it('with no visit, no doctor, no date of changes and an undated document', () => {
    const v1: PassportV1 = {
      patientName: 'A', patientAge: null, preparedBy: 'A', preparedOn: '2026-01-01', visitAt: '2026-02-01T10:00:00Z', prescriberName: null, prescriberSpecialty: null,
      currentMedicines: [], changesSince: null, changes: [{ kind: 'changed', text: 'X' }], flags: [], documents: [{ title: 'Old scan', documentDate: '' }], questions: [],
    };
    const wrapped = wrapV1Passport(v1, 'link');
    expect(wrapped.passport.visit).toEqual({ at: '2026-02-01T10:00:00Z', prescriberName: '', specialty: '' });
    expect(wrapped.passport.recentChanges).toEqual([{ kind: 'changed', text: 'X', on: '2026-01-01' }]);
    expect(wrapped.passport.documents[0].clinicalDate).toBeNull();
    expect(wrapWithoutVisit().passport.visit).toBeNull();
  });
});

function wrapWithoutVisit() {
  return wrapV1Passport({
    patientName: 'A', patientAge: null, preparedBy: 'A', preparedOn: '2026-01-01', visitAt: null, prescriberName: null, prescriberSpecialty: null,
    currentMedicines: [], changesSince: null, changes: [], flags: [], documents: [], questions: [],
  }, 'x');
}
