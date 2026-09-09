import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface StoredConnection {
  baseUrl: string;
  apiKey: string;
}

const CONNECTION_KEY = "lnkz.mobile.connection.v1";

function webStorage(): Storage | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export async function loadConnection(): Promise<StoredConnection | null> {
  const raw = Platform.OS === "web"
    ? webStorage()?.getItem(CONNECTION_KEY) ?? null
    : await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredConnection>;
    return typeof value.baseUrl === "string" && typeof value.apiKey === "string"
      ? { baseUrl: value.baseUrl, apiKey: value.apiKey }
      : null;
  } catch {
    return null;
  }
}

export async function saveConnection(value: StoredConnection): Promise<void> {
  const raw = JSON.stringify(value);
  if (Platform.OS === "web") {
    webStorage()?.setItem(CONNECTION_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(CONNECTION_KEY, raw, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearConnection(): Promise<void> {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(CONNECTION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
}
