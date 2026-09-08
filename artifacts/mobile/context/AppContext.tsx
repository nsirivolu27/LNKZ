import React, { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearCredentials,
  loadCredentials,
  loadThemePreference,
  saveCredentials,
  saveThemePreference,
  StoredCredentials,
  ThemePreference,
} from '@/services/credentials';
import { LnkzApiClient, normalizeBaseUrl } from '@/services/lnkz-api';

interface AppContextValue {
  credentials: StoredCredentials | null;
  isReady: boolean;
  themePreference: ThemePreference;
  api: LnkzApiClient | null;
  connect: (serverUrl: string, apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setThemePreference: (value: ThemePreference) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [themePreference, setThemeState] = useState<ThemePreference>('system');
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadCredentials(), loadThemePreference()])
      .then(([stored, theme]) => {
        setCredentials(stored);
        setThemeState(theme);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      credentials,
      isReady,
      themePreference,
      api: credentials ? new LnkzApiClient(credentials) : null,
      connect: async (serverUrl, apiKey) => {
        const next = { serverUrl: normalizeBaseUrl(serverUrl), apiKey: apiKey.trim() };
        await saveCredentials(next);
        setCredentials(next);
      },
      disconnect: async () => {
        await clearCredentials();
        setCredentials(null);
      },
      setThemePreference: async (value) => {
        await saveThemePreference(value);
        setThemeState(value);
      },
    }),
    [credentials, isReady, themePreference],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}