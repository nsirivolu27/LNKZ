import { normalizeBaseUrl } from '@/services/lnkz-api';

export const CREDENTIAL_KEYS = {
  serverUrl: 'lnkz.serverUrl',
  apiKey: 'lnkz.apiKey',
} as const;

export interface CredentialStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface CredentialValues {
  serverUrl: string;
  apiKey: string;
}

export async function readCredentials(storage: CredentialStorage): Promise<CredentialValues | null> {
  const [serverUrl, apiKey] = await Promise.all([
    storage.getItem(CREDENTIAL_KEYS.serverUrl),
    storage.getItem(CREDENTIAL_KEYS.apiKey),
  ]);
  if (!serverUrl || !apiKey) return null;
  return { serverUrl: normalizeBaseUrl(serverUrl), apiKey };
}

export async function writeCredentials(storage: CredentialStorage, credentials: CredentialValues): Promise<void> {
  const serverUrl = normalizeBaseUrl(credentials.serverUrl);
  const apiKey = credentials.apiKey.trim();
  if (!serverUrl || !apiKey) throw new Error('Enter both a relay URL and API key.');
  await Promise.all([
    storage.setItem(CREDENTIAL_KEYS.serverUrl, serverUrl),
    storage.setItem(CREDENTIAL_KEYS.apiKey, apiKey),
  ]);
}

export async function removeCredentials(storage: CredentialStorage): Promise<void> {
  await Promise.all([
    storage.deleteItem(CREDENTIAL_KEYS.serverUrl),
    storage.deleteItem(CREDENTIAL_KEYS.apiKey),
  ]);
}