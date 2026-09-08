import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Field, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, LnkzApiClient } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';
import { PROTOCOL_DOCS_URL } from '@/constants/links';

export default function WelcomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { credentials, isReady, connect } = useApp();
  const [serverUrl, setServerUrl] = useState(credentials?.serverUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isReady && credentials) router.replace('/(tabs)');
  }, [credentials, isReady, router]);

  if (!isReady || credentials) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  async function handleConnect() {
    setError('');
    setBusy(true);
    try {
      const client = new LnkzApiClient({ serverUrl, apiKey });
      await client.health();
      await connect(serverUrl, apiKey);
      router.replace('/(tabs)');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'Could not connect to this relay.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.content}>
        <View style={styles.mark}>
          <Text style={[styles.markText, { color: colors.primaryForeground, backgroundColor: colors.primary }]}>LNKZ</Text>
          <Text style={[styles.markRule, { backgroundColor: colors.accent }]} />
        </View>
        <View style={styles.hero}>
          <Text style={[styles.kicker, { color: colors.primary }]}>MOVE CONTEXT / KEEP MOMENTUM</Text>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>The useful parts{'\n'}should travel.</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            Connect this companion to your LNKZ relay. Your key stays in secure device storage; the app never creates a second server.
          </Text>
        </View>

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
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, gap: 28 },
  mark: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  markText: { paddingHorizontal: 7, paddingVertical: 4, fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: 1 },
  markRule: { width: 24, height: 9, marginBottom: 4 },
  hero: { gap: 12 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.5 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 42, lineHeight: 43, letterSpacing: -1.2 },
  heroBody: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, maxWidth: 340 },
  form: { padding: 17, borderWidth: 1.5, gap: 16 },
  formLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19 },
  footer: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, maxWidth: 320 },
});