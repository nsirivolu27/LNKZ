import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppScreen, Chip, ErrorNotice, Field, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, DryRunPreview, ImportFormat } from '@/services/lnkz-api';
import { formatWarningList } from '@/services/redaction';
import { useColors } from '@/hooks/useColors';

const FORMATS: ImportFormat[] = ['auto', 'chatgpt', 'claude', 'gemini', 'markdown', 'text'];

export default function ImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { api } = useApp();
  const [mode, setMode] = useState<'payload' | 'url'>('payload');
  const [payload, setPayload] = useState('');
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [error, setError] = useState('');

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      if (mode === 'url') {
        if (!url.trim()) throw new ApiError('Paste a share URL first.', 0);
        const result = await api.importUrl(url.trim(), true);
        if (!('preview' in result)) {
          throw new ApiError('The relay did not return a preview for that share URL.', 422);
        }
        return {
          warnings: result.warnings,
          preview: [result.preview],
        } satisfies DryRunPreview;
      }
      if (!payload.trim()) throw new ApiError('Paste a transcript first.', 0);
      return (await api.importPayload(payload, format, true)) as DryRunPreview;
    },
    onSuccess: (result) => {
      setError('');
      setPreview(result);
    },
    onError: (nextError) => setError(nextError instanceof Error ? nextError.message : 'Preview failed.'),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      if (mode === 'url') return api.importUrl(url.trim(), false);
      return api.importPayload(payload, format, false);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      const conversation = 'conversation' in result
        ? result.conversation
        : 'conversations' in result
          ? result.conversations[0]
          : undefined;
      Alert.alert('Imported', 'The conversation is now in your library.');
      router.replace(conversation ? `/conversations/${conversation.id}` : '/(tabs)');
    },
    onError: (nextError) => setError(nextError instanceof Error ? nextError.message : 'Import failed.'),
  });

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="02 / THE PACKET"
        title="Bring it with you."
        description="Preview first. Save only when the shape looks right."
        right={<SecondaryButton label="Close" onPress={() => router.back()} />}
      />
      <View style={[styles.modePanel, { borderColor: colors.border }]}>
        <SectionLabel>INPUT ROUTE</SectionLabel>
        <View style={styles.modeRow}>
        <Chip label="PASTE TRANSCRIPT" selected={mode === 'payload'} onPress={() => { setMode('payload'); setPreview(null); }} />
        <Chip label="LNKZ SHARE URL" selected={mode === 'url'} onPress={() => { setMode('url'); setPreview(null); }} />
        </View>
      </View>
      {mode === 'url' ? (
        <Field
          label="Share URL"
          hint="expiring links are pulled securely"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://relay.example.com/share/..."
          testID="share-url-input"
        />
      ) : (
        <>
          <Field
            label="Transcript payload"
            hint={`${payload.length.toLocaleString()} chars`}
            value={payload}
            onChangeText={setPayload}
            multiline
            placeholder="Paste ChatGPT, Claude, Gemini, Markdown, or plain text here..."
            testID="transcript-input"
          />
          <SectionLabel>FORMAT HINT</SectionLabel>
          <View style={styles.formatRow}>
            {FORMATS.map((item) => <Chip key={item} label={item} selected={format === item} onPress={() => setFormat(item)} />)}
          </View>
        </>
      )}
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <PrimaryButton label="Preview import" icon="eye" onPress={() => previewMutation.mutate()} loading={previewMutation.isPending || importMutation.isPending} />
        {preview ? <SecondaryButton label="Save to library" icon="download" onPress={() => importMutation.mutate()} disabled={previewMutation.isPending || importMutation.isPending} /> : null}
      </View>
      {preview ? (
        <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel>{preview.preview.length} CONVERSATION{preview.preview.length === 1 ? '' : 'S'} FOUND</SectionLabel>
          {preview.preview.map((item) => (
            <View key={`${item.title}-${item.provider}`} style={[styles.previewRow, { borderColor: colors.input }]}>
              <View style={styles.previewCopy}>
                <Text style={[styles.previewTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>{item.provider} · {item.messages} messages</Text>
              </View>
              <Text style={[styles.check, { color: colors.primary }]}>OK</Text>
            </View>
          ))}
          {preview.warnings.length ? (
            <View style={[styles.warningBox, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.warningTitle, { color: colors.foreground }]}>Review before saving</Text>
              {formatWarningList(preview.warnings).map((warning) => <Text key={warning} style={[styles.warning, { color: colors.mutedForeground }]}>• {warning}</Text>)}
            </View>
          ) : <Text style={[styles.clean, { color: colors.primary }]}>No import warnings.</Text>}
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  modePanel: { padding: 12, borderTopWidth: 1.5, borderBottomWidth: 1.5, gap: 10 },
  modeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  formatRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: -8 },
  actions: { gap: 10 },
  preview: { padding: 14, gap: 13, borderWidth: 1.5 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderBottomWidth: 1 },
  previewCopy: { flex: 1, gap: 4 },
  previewTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  previewMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  check: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  warningBox: { padding: 12, gap: 5 },
  warningTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  warning: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  clean: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});