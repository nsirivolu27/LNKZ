import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  CredentialStorage,
  CredentialValues,
  readCredentials,
  removeCredentials,
  writeCredentials,
} from '@/services/credential-store';

const THEME_KEY = 'lnkz.themePreference';
const webMemoryStore = new Map<string, string>();

export type ThemePreference = 'system' | 'light' | 'dark';
export interface StoredCredentials {
  serverUrl: string;
  apiKey: string;
}

const credentialStorage: CredentialStorage = {
  getItem,
  setItem,
  deleteItem,
};

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
  return readCredentials(credentialStorage);
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await writeCredentials(credentialStorage, credentials satisfies CredentialValues);
}

export async function clearCredentials(): Promise<void> {
  await removeCredentials(credentialStorage);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const value = await getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  await setItem(THEME_KEY, value);
}