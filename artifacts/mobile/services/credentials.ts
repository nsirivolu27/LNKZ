import * as SecureStore from 'expo-secure-store';
import { normalizeBaseUrl } from '@/services/lnkz-api';

const SERVER_URL_KEY = 'lnkz.serverUrl';
const API_KEY_KEY = 'lnkz.apiKey';
const THEME_KEY = 'lnkz.themePreference';

export type ThemePreference = 'system' | 'light' | 'dark';
export interface StoredCredentials {
  serverUrl: string;
  apiKey: string;
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const [serverUrl, apiKey] = await Promise.all([
    SecureStore.getItemAsync(SERVER_URL_KEY),
    SecureStore.getItemAsync(API_KEY_KEY),
  ]);
  if (!serverUrl || !apiKey) return null;
  return { serverUrl, apiKey };
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  const serverUrl = normalizeBaseUrl(credentials.serverUrl);
  if (!serverUrl || !credentials.apiKey.trim()) {
    throw new Error('Enter both a relay URL and API key.');
  }
  await Promise.all([
    SecureStore.setItemAsync(SERVER_URL_KEY, serverUrl),
    SecureStore.setItemAsync(API_KEY_KEY, credentials.apiKey.trim()),
  ]);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SERVER_URL_KEY),
    SecureStore.deleteItemAsync(API_KEY_KEY),
  ]);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const value = await SecureStore.getItemAsync(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, value);
}