import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { normalizeBaseUrl } from '@/services/lnkz-api';

const SERVER_URL_KEY = 'lnkz.serverUrl';
const API_KEY_KEY = 'lnkz.apiKey';
const THEME_KEY = 'lnkz.themePreference';
const webMemoryStore = new Map<string, string>();

export type ThemePreference = 'system' | 'light' | 'dark';
export interface StoredCredentials {
  serverUrl: string;
  apiKey: string;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webMemoryStore.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webMemoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webMemoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const [serverUrl, apiKey] = await Promise.all([
    getItem(SERVER_URL_KEY),
    getItem(API_KEY_KEY),
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
    setItem(SERVER_URL_KEY, serverUrl),
    setItem(API_KEY_KEY, credentials.apiKey.trim()),
  ]);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    deleteItem(SERVER_URL_KEY),
    deleteItem(API_KEY_KEY),
  ]);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const value = await getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  await setItem(THEME_KEY, value);
}