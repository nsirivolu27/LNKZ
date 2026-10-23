import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppScreen, Chip, ErrorNotice, Field, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, HandoffIssue } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';

export default function NewHandoffScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { api } = useApp();
  const [ttlMinutes, setTtlMinutes] = useState('60');
  const [maxUses, setMaxUses] = useState('25');
  const [audience, setAudience] = useState('');
  const [note, setNote] = useState('');
  const [redact, setRedact] = useState(false);
  const [issued, setIssued] = useState<HandoffIssue | null>(null);
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!api || !conversationId) throw new ApiError('Conversation is missing.', 0);
      return api.createHandoff(conversationId, {
        ttlMinutes: Math.max(5, Math.min(10080, Number(ttlMinutes) || 60)),
        maxUses: Math.max(1, Math.min(1000, Number(maxUses) || 25)),
        audience: audience.trim() || undefined,
        note: note.trim() || undefined,
        redact,
      });
    },
    onSuccess: (handoff) => {
      setError('');
      setIssued(handoff);
      queryClient.invalidateQueries({ queryKey: ['handoffs'] });
    },
    onError: (nextError) => setError(nextError instanceof Error ? nextError.message : 'Could not create handoff.'),
  });

  async function copyLink() {
    if (issued) await Clipboard.setStringAsync(issued.shareUrl);
  }

  async function shareLink() {
    if (issued) await Share.share({ message: issued.shareUrl, url: issued.shareUrl });
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="03 / THE HANDOFF"
        title={issued ? 'Link is live.' : 'Send it forward.'}
        description={issued ? 'This link is private, expiring, and ready to paste into Claude or a teammate chat.' : 'Shape the boundary before you share the context.'}
        right={<SecondaryButton label="Close" onPress={() => router.back()} />}
      />
      {issued ? (
        <View style={[styles.issued, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel>PRIVATE EXPIRING LINK</SectionLabel>
          <Text selectable style={[styles.shareUrl, { color: colors.foreground }]}>{issued.shareUrl}</Text>
          <Text style={[styles.issuedMeta, { color: colors.mutedForeground }]}>{issued.maxUses} uses · expires {new Date(issued.expiresAt).toLocaleString()}</Text>
          <View style={styles.shareActions}>
            <PrimaryButton label="Copy link" icon="copy" onPress={copyLink} style={styles.half} />
            <SecondaryButton label="Share" icon="send" onPress={shareLink} />
          </View>
          <Chip label={issued.redact ? 'REDACTION ON' : 'FULL CONTEXT'} selected={issued.redact} />
        </View>
      ) : (
        <>
          <View style={styles.twoCol}>
            <View style={styles.flex}><Field label="Expires in" hint="minutes" value={ttlMinutes} onChangeText={setTtlMinutes} keyboardType="number-pad" /></View>
            <View style={styles.flex}><Field label="Max uses" hint="1–1000" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" /></View>
          </View>
          <Field label="Audience" hint="optional" value={audience} onChangeText={setAudience} placeholder="Claude / design team / ..." />
          <Field label="Note" hint="optional" value={note} onChangeText={setNote} multiline placeholder="What should the recipient know?" />
          <View style={[styles.redactRow, { backgroundColor: colors.card, borderColor: colors.input }]}>
            <View style={styles.redactCopy}><Text style={[styles.redactTitle, { color: colors.foreground }]}>Redact sensitive patterns</Text><Text style={[styles.redactBody, { color: colors.mutedForeground }]}>Let the relay remove known secrets before minting the link.</Text></View>
            <Chip label={redact ? 'ON' : 'OFF'} selected={redact} onPress={() => setRedact((value) => !value)} />
          </View>
          {error ? <ErrorNotice message={error} /> : null}
          <PrimaryButton label="Create secure handoff" icon="link" onPress={() => createMutation.mutate()} loading={createMutation.isPending} />
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  twoCol: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  redactRow: { padding: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: 12 },
  redactCopy: { flex: 1, gap: 4 },
  redactTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  redactBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  issued: { padding: 14, borderWidth: 1.5, gap: 13 },
  shareUrl: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  issuedMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  shareActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  half: { flex: 1 },
});