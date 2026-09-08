import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMutation } from '@tanstack/react-query';
import { AppScreen, Chip, ErrorNotice, Field, PrimaryButton, ScreenHeader, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, ContextPacket } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';

export default function BuildPacketScreen() {
  const colors = useColors();
  const { api } = useApp();
  const [query, setQuery] = useState('');
  const [budgetTokens, setBudgetTokens] = useState('4000');
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [copied, setCopied] = useState(false);

  const buildMutation = useMutation({
    mutationFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      if (!query.trim()) throw new ApiError('Add a question or topic first.', 0);
      return api.buildPacket({ query: query.trim(), budgetTokens: Math.max(500, Math.min(60000, Number(budgetTokens) || 4000)) });
    },
    onSuccess: (result) => { setPacket(result.packet); setCopied(false); },
  });

  async function copyPacket() {
    if (!packet) return;
    await Clipboard.setStringAsync(packet.markdown);
    setCopied(true);
  }

  async function sharePacket() {
    if (packet) await Share.share({ message: packet.markdown });
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="04 / BUILD"
        title="Make the next model smarter."
        description="Ask for a slice of context. LNKZ will assemble a bounded packet with decisions, open questions, and useful excerpts."
      />
      <Field
        label="What do you need to carry?"
        hint="required"
        value={query}
        onChangeText={setQuery}
        multiline
        placeholder="e.g. What did we decide about the mobile import flow?"
        testID="packet-query-input"
      />
      <View style={styles.tokenRow}>
        <Text style={[styles.tokenLabel, { color: colors.foreground }]}>TOKEN BUDGET</Text>
        <View style={styles.tokenChips}>
          {['2000', '4000', '8000'].map((value) => <Chip key={value} label={value} selected={budgetTokens === value} onPress={() => setBudgetTokens(value)} />)}
        </View>
      </View>
      <PrimaryButton label="Build context packet" icon="zap" onPress={() => buildMutation.mutate()} loading={buildMutation.isPending} />
      {buildMutation.error ? <ErrorNotice message={buildMutation.error instanceof Error ? buildMutation.error.message : 'Could not build packet.'} /> : null}
      {packet ? (
        <View style={[styles.packet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.packetTop}>
            <View style={styles.packetHeading}>
              <SectionLabel>READY TO MOVE</SectionLabel>
              <Text style={[styles.packetMeta, { color: colors.mutedForeground }]}>{packet.usedTokens.toLocaleString()} / {packet.budgetTokens.toLocaleString()} tokens · {packet.conversations.length} sources</Text>
            </View>
            <Chip label={copied ? 'COPIED' : 'MARKDOWN'} selected={copied} />
          </View>
          <Text selectable style={[styles.markdown, { color: colors.foreground }]}>{packet.markdown}</Text>
          <View style={styles.packetActions}>
            <PrimaryButton label={copied ? 'Copied' : 'Copy packet'} icon="copy" onPress={copyPacket} style={styles.flex} />
            <PrimaryButton label="Share" icon="send" onPress={sharePacket} style={styles.flex} />
          </View>
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tokenRow: { gap: 9 },
  tokenLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.1 },
  tokenChips: { flexDirection: 'row', gap: 8 },
  packet: { padding: 16, borderWidth: 1.5, gap: 14 },
  packetTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  packetHeading: { flex: 1, gap: 5 },
  packetMeta: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  markdown: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  packetActions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});