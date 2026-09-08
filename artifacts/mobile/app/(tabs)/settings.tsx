import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppScreen, Chip, ErrorNotice, Field, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, LnkzApiClient } from '@/services/lnkz-api';
import { ThemePreference } from '@/services/credentials';
import { useColors } from '@/hooks/useColors';
import { PROTOCOL_DOCS_URL } from '@/constants/links';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { api, credentials, themePreference, connect, disconnect, setThemePreference } = useApp();
  const [serverUrl, setServerUrl] = useState(credentials?.serverUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connectorsQuery = useQuery({
    queryKey: ['connectors'],
    enabled: Boolean(api),
    queryFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return api.connectors();
    },
  });

  async function saveConnection() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const client = new LnkzApiClient({ serverUrl, apiKey: apiKey || credentials?.apiKey || '' });
      await client.health();
      await connect(serverUrl, apiKey || credentials?.apiKey || '');
      setStatus('Connection tested and saved.');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'Could not test the relay.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    Alert.alert('Reset this device?', 'This removes the saved relay URL and API key from secure storage.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => { await disconnect(); router.replace('/'); } },
    ]);
  }

  return (
    <AppScreen>
      <ScreenHeader eyebrow="04 / THE SETTINGS" title="Make it yours." description="The relay remains the source of truth. This app only stores your connection and preferences." />
      <View style={[styles.section, { borderColor: colors.border }]}>
        <SectionLabel>RELAY CONNECTION</SectionLabel>
        <Field label="Server URL" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label="API key" hint="leave blank to keep current" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        {error ? <ErrorNotice message={error} /> : null}
        {status ? <Text style={[styles.status, { color: colors.primary }]}>{status}</Text> : null}
        <PrimaryButton label="Test & save connection" icon="check" onPress={saveConnection} loading={busy} />
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <SectionLabel>APPEARANCE</SectionLabel>
        <View style={styles.themeRow}>{THEMES.map((theme) => <Chip key={theme} label={theme} selected={themePreference === theme} onPress={() => setThemePreference(theme)} />)}</View>
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <SectionLabel>AVAILABLE SOURCES</SectionLabel>
        {connectorsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : connectorsQuery.error ? (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Source status is unavailable right now.</Text>
        ) : (
          connectorsQuery.data?.connectors.map((connector) => (
            <View key={connector.id} style={styles.connectorRow}>
              <View style={styles.connectorCopy}>
                <Text style={[styles.connectorLabel, { color: colors.foreground }]}>{connector.label}</Text>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>{connector.detail}</Text>
              </View>
              <Chip label={connector.configured ? 'READY' : 'OFF'} selected={connector.configured} />
            </View>
          ))
        )}
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <SectionLabel>ABOUT LNKZ</SectionLabel>
        <SecondaryButton label="Open protocol documentation" icon="book-open" onPress={() => Linking.openURL(PROTOCOL_DOCS_URL).catch(() => undefined)} />
        <SecondaryButton label="View health endpoint" icon="activity" onPress={() => credentials ? Linking.openURL(`${credentials.serverUrl}/health`).catch(() => undefined) : undefined} />
      </View>
      <View style={[styles.danger, { borderColor: colors.destructive }]}>
        <Text style={[styles.dangerTitle, { color: colors.foreground }]}>DEVICE RESET</Text>
        <Text style={[styles.dangerBody, { color: colors.mutedForeground }]}>Remove local credentials before handing this device to someone else.</Text>
        <SecondaryButton label="Reset connection" icon="trash-2" onPress={reset} />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 12, borderTopWidth: 1.5, borderBottomWidth: 1.5 },
  themeRow: { flexDirection: 'row', gap: 8 },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  muted: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  connectorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#c9c3b9' },
  connectorCopy: { flex: 1, gap: 3 },
  connectorLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  danger: { padding: 15, borderWidth: 1.5, gap: 10 },
  dangerTitle: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  dangerBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});