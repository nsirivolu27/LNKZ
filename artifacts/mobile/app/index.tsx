import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Field, FieldHandoffHeader, FieldHandoffPreview, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, LnkzApiClient } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';
import { PROTOCOL_DOCS_URL } from '@/constants/links';
import { defaultRelayUrl, requestBrowserPreviewSession } from '@/services/config';

export default function WelcomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { credentials, isReady, connect } = useApp();
  const defaultServerUrl = defaultRelayUrl();
  const [serverUrl, setServerUrl] = useState(credentials?.serverUrl ?? defaultServerUrl);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(Platform.OS === 'web' && Boolean(defaultServerUrl));
  const [error, setError] = useState('');
  const previewAttempted = useRef(false);

  useEffect(() => {
    if (isReady && credentials) router.replace('/(tabs)');
  }, [credentials, isReady, router]);

  useEffect(() => {
    if (!isReady || credentials || Platform.OS !== 'web' || previewAttempted.current) return;
    previewAttempted.current = true;
    void requestBrowserPreviewSession(defaultServerUrl)
      .then(async (previewCredentials) => {
        if (!previewCredentials) return;
        const client = new LnkzApiClient(previewCredentials);
        await client.validateConnection();
        await connect(previewCredentials.serverUrl, previewCredentials.apiKey);
        router.replace('/(tabs)');
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : 'Could not start the connected preview.');
      })
      .finally(() => setAutoConnecting(false));
  }, [connect, credentials, defaultServerUrl, isReady, router]);

  if (!isReady || credentials || autoConnecting) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  async function handleConnect() {
    setError('');
    setBusy(true);
    try {
      const client = new LnkzApiClient({ serverUrl, apiKey });
      await client.validateConnection();
      await connect(serverUrl, apiKey);
      router.replace('/(tabs)');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'Could not connect to this relay.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen style={styles.page}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.content}>
        <FieldHandoffHeader
          onSend={() => setError('Connect your relay below to send context.')}
          onPacket={() => setError('Connect your relay below to build a packet.')}
          onHandoff={() => setError('Connect your relay below to create a handoff.')}
          onSettings={() => setError('Connect your relay below to open settings.')}
        />
        <View style={styles.hero}>
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>RELAY / NOTICE OF CHANGE / EFFECTIVE IMMEDIATELY</Text>
          <Text style={[styles.heroWord, { color: colors.foreground }]}>NOISE.</Text>
          <Text style={[styles.heroSubword, { color: colors.foreground }]}>IS NOW</Text>
          <Text style={[styles.heroHighlight, { color: colors.accentForeground, backgroundColor: colors.accent }]}>USEFUL.</Text>
          <Text style={[styles.heroBody, { color: colors.foreground }]}>
            CONNECT YOUR RELAY TO KEEP THE DECISIONS, THE OPEN QUESTIONS, AND THE USEFUL PART OF THE ROUTE PORTABLE.
          </Text>
        </View>

        <FieldHandoffPreview onImport={() => setError('Connect your relay below to import a conversation.')} />

        <View style={[styles.form, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.formLabel, { color: colors.foreground }]}>01 / CONNECT TO YOUR RELAY</Text>
          <Field
            label="Relay URL"
            hint="https://..."
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://relay.example.com"
            testID="relay-url-input"
          />
          <Field
            label="API key"
            hint="stored securely"
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Paste your LNKZ key"
            testID="api-key-input"
          />
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
          <PrimaryButton label="Test & connect" icon="arrow-right" onPress={handleConnect} loading={busy} />
          <SecondaryButton label="Read the protocol docs" icon="book-open" onPress={() => Linking.openURL(PROTOCOL_DOCS_URL).catch(() => undefined)} />
        </View>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>A private tool for moving conversation context between models, devices, and people.</Text>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingTop: 10 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, gap: 18 },
  hero: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.9, marginBottom: 12 },
  heroWord: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 42, letterSpacing: -1.6 },
  heroSubword: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 22, letterSpacing: 3.2, marginTop: 8 },
  heroHighlight: { alignSelf: 'flex-start', fontFamily: 'Inter_700Bold', fontSize: 40, lineHeight: 44, letterSpacing: -1.2, paddingHorizontal: 4, marginTop: 1 },
  heroBody: { fontFamily: 'Inter_700Bold', fontSize: 9, lineHeight: 13, letterSpacing: 0.25, marginTop: 13, maxWidth: 320 },
  form: { padding: 17, borderWidth: 1.5, gap: 16 },
  formLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19 },
  footer: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, maxWidth: 320 },
});