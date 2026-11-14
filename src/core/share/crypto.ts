// AES-GCM for shared passports, with the browser's Web Crypto. The key is made on the
// phone and travels only in the fragment of the link, which browsers never send to a server.

const bytesOf = (value: ArrayBuffer | Uint8Array) => (value instanceof Uint8Array ? value : new Uint8Array(value));

export function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = bytesOf(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url text.');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}

/** Encrypts JSON-serialisable data with a fresh 256-bit key and a fresh 96-bit IV. */
export async function encryptJson(data: unknown): Promise<Sealed & { key: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    ciphertext: toBase64Url(ciphertext),
    iv: toBase64Url(iv),
    key: toBase64Url(await crypto.subtle.exportKey('raw', key)),
  };
}

/** Rejects if the key is wrong or the ciphertext was altered: AES-GCM checks both. */
export async function decryptJson(sealed: Sealed, key: string): Promise<unknown> {
  const raw = fromBase64Url(key);
  if (raw.length !== 32) throw new Error('The key has the wrong length.');
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(sealed.iv) },
    cryptoKey,
    fromBase64Url(sealed.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
