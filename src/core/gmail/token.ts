// Google Identity Services, token model. The access token is short-lived and lives in
// this module's memory only: it is never written to IndexedDB and never sent to our server.
import { ServiceError } from '../../contract/types';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}

type GoogleGlobal = { accounts?: { oauth2?: GoogleOAuth2 } };

export interface TokenSource {
  /** Opens Google's consent window. Call it from a tap or click. */
  connect(): Promise<void>;
  /** The current token, or a rejection asking the caregiver to connect (again). */
  token(): string;
  isConnected(): boolean;
  disconnect(): void;
}

function loadScript(): Promise<GoogleOAuth2> {
  const existing = (globalThis as { google?: GoogleGlobal }).google?.accounts?.oauth2;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () => {
      const oauth2 = (globalThis as { google?: GoogleGlobal }).google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new ServiceError('unknown', 'Google sign-in did not load.'));
    };
    script.onerror = () => reject(new ServiceError('network', 'Google sign-in could not be loaded. Check the connection.'));
    document.head.append(script);
  });
}

export interface TokenSourceOptions {
  clientId: string | undefined;
  /** Defaults to loading the Google Identity Services script. */
  load?: () => Promise<GoogleOAuth2>;
  now?: () => number;
}

export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const now = options.now ?? (() => Date.now());
  let current: { value: string; expiresAt: number } | null = null;

  const isConnected = () => current !== null && current.expiresAt > now();

  return {
    isConnected,
    disconnect() {
      current = null;
    },
    token() {
      if (!isConnected()) {
        current = null;
        throw new ServiceError('unknown', 'Connect Gmail first.');
      }
      return current!.value;
    },
    async connect() {
      if (!options.clientId) {
        throw new ServiceError('unknown', 'Gmail import is not set up: VITE_GOOGLE_CLIENT_ID is missing.');
      }
      const oauth2 = await (options.load ?? loadScript)();
      await new Promise<void>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: options.clientId!,
          scope: GMAIL_SCOPE,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new ServiceError('unknown', 'Gmail was not connected. Nothing was read.'));
              return;
            }
            if (!oauth2.hasGrantedAllScopes(response, GMAIL_SCOPE)) {
              reject(new ServiceError('unknown', 'Permission to read Gmail was not given. Nothing was read.'));
              return;
            }
            // Treat the token as expired a minute early so a request never starts with a dying token.
            const lifetime = Number(response.expires_in) > 0 ? Number(response.expires_in) : 3300;
            current = { value: response.access_token, expiresAt: now() + (lifetime - 60) * 1000 };
            resolve();
          },
          error_callback: () => reject(new ServiceError('unknown', 'The Google window was closed. Nothing was read.')),
        });
        client.requestAccessToken();
      });
    },
  };
}
