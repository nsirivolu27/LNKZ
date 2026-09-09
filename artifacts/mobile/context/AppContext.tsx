import React, { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { updateConversationSelection } from '@/services/context-selection';

interface AppContextValue {
  credentials: StoredCredentials | null;
  isReady: boolean;
  themePreference: ThemePreference;
  api: LnkzApiClient | null;
  selectedConversationIds: string[];
  connect: (serverUrl: string, apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setConversationSelected: (conversationId: string, selected: boolean) => void;
  clearContextSelection: () => void;
  setThemePreference: (value: ThemePreference) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
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
      selectedConversationIds,
      connect: async (serverUrl, apiKey) => {
        const next = { serverUrl: normalizeBaseUrl(serverUrl), apiKey: apiKey.trim() };
        await saveCredentials(next);
        if (credentials?.serverUrl !== next.serverUrl || credentials.apiKey !== next.apiKey) {
          queryClient.clear();
          setSelectedConversationIds([]);
        }
        setCredentials(next);
      },
      disconnect: async () => {
        await clearCredentials();
        queryClient.clear();
        setSelectedConversationIds([]);
        setCredentials(null);
      },
      setConversationSelected: (conversationId, selected) => {
        setSelectedConversationIds((current) => updateConversationSelection(current, conversationId, selected));
      },
      clearContextSelection: () => setSelectedConversationIds([]),
      setThemePreference: async (value) => {
        await saveThemePreference(value);
        setThemeState(value);
      },
    }),
    [credentials, isReady, queryClient, selectedConversationIds, themePreference],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}