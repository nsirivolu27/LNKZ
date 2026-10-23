import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppScreen, Chip, ErrorNotice, IconButton, PrimaryButton, ScreenHeader, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';

export default function ConversationDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, selectedConversationIds, setConversationSelected } = useApp();
  const conversationId = String(id);
  const selected = selectedConversationIds.includes(conversationId);
  const detailQuery = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: Boolean(api && conversationId),
    queryFn: async ({ signal }) => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return api.getConversation(conversationId, signal);
    },
  });

  if (detailQuery.isLoading) return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  if (detailQuery.error || !detailQuery.data) return <AppScreen><ErrorNotice message={detailQuery.error instanceof Error ? detailQuery.error.message : 'Conversation not found.'} onRetry={() => detailQuery.refetch()} /></AppScreen>;

  const { conversation, analysis } = detailQuery.data;
  return (
    <AppScreen>
      <ScreenHeader
        eyebrow={`01 / THE THREAD · ${conversation.source.provider.toUpperCase()} · ${conversation.messages.length} MESSAGES`}
        title={conversation.title}
        description={conversation.summary}
        right={<IconButton icon="x" label="Close conversation" onPress={() => router.back()} />}
      />
      <View style={styles.actions}>
        <PrimaryButton label="Create handoff" icon="link" onPress={() => router.push({ pathname: '/handoff/new', params: { conversationId } })} />
        <View style={styles.selectionActions}>
          <PrimaryButton
            label={selected ? 'Remove from packet' : 'Add to packet'}
            icon={selected ? 'minus-circle' : 'plus-circle'}
            onPress={() => setConversationSelected(conversationId, !selected)}
            style={styles.flex}
          />
          <PrimaryButton
            label="Build packet"
            icon="zap"
            onPress={() => {
              if (!selected) setConversationSelected(conversationId, true);
              router.push('/build');
            }}
            style={styles.flex}
          />
        </View>
        <Text style={[styles.selectionHint, { color: colors.mutedForeground }]}>
          {selected ? 'This conversation will be included in the next context packet.' : 'Select this conversation to carry its bounded context into the packet builder.'}
        </Text>
        <View style={styles.metaRow}>
          {conversation.tags.slice(0, 4).map((tag) => <Chip key={tag} label={tag} />)}
          {conversation.lineage?.originVerification ? <Chip label={conversation.lineage.originVerification} selected={conversation.lineage.originVerification === 'verified'} /> : null}
        </View>
      </View>

      {analysis ? (
        <View style={[styles.analysis, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel>READOUT</SectionLabel>
          <View style={styles.stats}>
            <Stat value={String(analysis.messageCount)} label="messages" />
            <Stat value={String(analysis.decisions.length)} label="decisions" />
            <Stat value={String(analysis.openQuestions.length)} label="open questions" />
            <Stat value={String(analysis.actionItems.length)} label="actions" />
          </View>
          {analysis.actionItems.length ? <ClaimGroup title="ACTION ITEMS" items={analysis.actionItems.map((item) => item.text)} /> : null}
          {analysis.openQuestions.length ? <ClaimGroup title="OPEN QUESTIONS" items={analysis.openQuestions.map((item) => item.text)} /> : null}
          {analysis.decisions.length ? <ClaimGroup title="DECISIONS" items={analysis.decisions.map((item) => item.text)} /> : null}
        </View>
      ) : null}

      <SectionLabel>TRANSCRIPT</SectionLabel>
      <View style={styles.messages}>
        {conversation.messages.map((message) => (
          <View key={message.id} style={[styles.message, { borderColor: colors.input }]}>
            <View style={styles.messageHeader}>
              <Text style={[styles.role, { color: message.role === 'assistant' ? colors.primary : colors.foreground }]}>{message.role.toUpperCase()}</Text>
              <Text style={[styles.messageDate, { color: colors.mutedForeground }]}>{message.author || 'anonymous'}</Text>
            </View>
            <Text style={[styles.messageText, { color: colors.foreground }]}>{message.content}</Text>
          </View>
        ))}
      </View>
    </AppScreen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const colors = useColors();
  return <View style={styles.stat}><Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text></View>;
}

function ClaimGroup({ title, items }: { title: string; items: string[] }) {
  const colors = useColors();
  return <View style={styles.claimGroup}><Text style={[styles.claimTitle, { color: colors.primary }]}>{title}</Text>{items.slice(0, 4).map((item) => <Text key={item} style={[styles.claim, { color: colors.foreground }]}>• {item}</Text>)}</View>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  actions: { gap: 12 },
  selectionActions: { flexDirection: 'row', gap: 8 },
  selectionHint: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  flex: { flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  analysis: { padding: 14, borderWidth: 1.5, gap: 16 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  stat: { minWidth: 70, gap: 3 },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 23 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  claimGroup: { gap: 5 },
  claimTitle: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  claim: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  messages: { gap: 10, paddingBottom: 30 },
  message: { padding: 13, borderWidth: 1.5 },
  messageHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  role: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  messageDate: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  messageText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
});