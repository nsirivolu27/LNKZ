import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  AppScreen,
  Chip,
  ConversationCard,
  EmptyState,
  ErrorNotice,
  FieldHandoffHeader,
  FieldHandoffStat,
  SecondaryButton,
  SectionLabel,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError, ConversationSummary } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';

const PROVIDERS = ['all', 'chatgpt', 'claude', 'gemini'] as const;

export default function LibraryScreen() {
  const colors = useColors();
  const router = useRouter();
  const { api } = useApp();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('all');
  const [showFilters, setShowFilters] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ['conversations', query.trim(), provider],
    enabled: Boolean(api),
    queryFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      if (query.trim()) {
        const result = await api.searchConversations(query.trim());
        return result.matches as ConversationSummary[];
      }
      const result = await api.listConversations({ provider: provider === 'all' ? undefined : provider });
      return result.conversations;
    },
  });
  const statsQuery = useQuery({
    queryKey: ['stats'],
    enabled: Boolean(api),
    queryFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return api.stats();
    },
  });

  const conversations = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const messageCount = conversations.reduce((total, item) => total + item.messageCount, 0);
  const stats = statsQuery.data?.stats;
  const error = libraryQuery.error instanceof Error ? libraryQuery.error.message : null;

  return (
    <AppScreen scroll={false} style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={undefined}
      >
        <FieldHandoffHeader
          onSend={() => router.push('/import')}
          onPacket={() => router.push('/build')}
          onHandoff={() => router.push('/handoffs')}
          onSettings={() => router.push('/settings')}
          onThread={() => router.push('/(tabs)')}
        />

        <View style={styles.hero}>
          <Text style={[styles.heroKicker, { color: colors.mutedForeground }]}>RELAY / NOTICE OF CHANGE / EFFECTIVE IMMEDIATELY</Text>
          <Text style={[styles.heroWord, { color: colors.foreground }]}>NOISE.</Text>
          <Text style={[styles.heroSubword, { color: colors.foreground }]}>IS NOW</Text>
          <Text style={[styles.heroHighlight, { color: colors.accentForeground, backgroundColor: colors.accent }]}>USEFUL.</Text>
          <Text style={[styles.heroBody, { color: colors.foreground }]}>
            PICK ONE CONVERSATION. LNKZ KEEPS THE DECISIONS, THE OPEN QUESTIONS, AND THE USEFUL PART OF THE ROUTE.
          </Text>
        </View>

        <View style={[styles.threadHeading, { borderColor: colors.border }]}>
          <SectionLabel>THE THREAD</SectionLabel>
          <SecondaryButton label="Import a conversation" icon="download" onPress={() => router.push('/import')} />
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchText, { color: colors.foreground }]}
            value={query}
            onChangeText={setQuery}
            placeholder="SEARCH THE THREAD"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            returnKeyType="search"
            testID="conversation-search-input"
          />
          <Chip label={showFilters ? 'CLOSE' : 'FILTER'} selected={showFilters} onPress={() => setShowFilters((visible) => !visible)} />
        </View>

        {showFilters ? (
          <View style={styles.filterRow}>
            {PROVIDERS.map((item) => (
              <Chip key={item} label={item} selected={provider === item} onPress={() => setProvider(item)} />
            ))}
          </View>
        ) : null}

        {libraryQuery.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <ErrorNotice message={error} onRetry={() => libraryQuery.refetch()} />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon="archive"
            title={query ? 'No matching context' : 'Your thread is empty'}
            description={query ? 'Try a broader search or another provider.' : 'Import a transcript to make the useful parts portable.'}
            action={<Chip label="IMPORT A TRANSCRIPT" selected onPress={() => router.push('/import')} />}
          />
        ) : (
          <View style={styles.conversationList}>
            {conversations.map((conversation) => (
              <ConversationCard key={conversation.id} conversation={conversation} onPress={() => router.push(`/conversations/${conversation.id}`)} />
            ))}
          </View>
        )}

        <View style={[styles.statsRow, { borderColor: colors.border }]}>
          <FieldHandoffStat label="THREADS" value={String(stats?.conversations ?? conversations.length)} style={styles.statHalf} />
          <FieldHandoffStat label="MESSAGES" value={(stats?.messages ?? messageCount).toLocaleString()} style={styles.statHalf} />
          <FieldHandoffStat label="HANDOFFS" value={String(stats?.activeHandoffs ?? 0)} style={styles.statHalf} />
          <FieldHandoffStat label="SOURCES" value={String(stats?.providers.length ?? 0)} style={styles.statHalf} />
        </View>
        <View style={[styles.footer, { backgroundColor: colors.foreground }]}>
          <Text style={[styles.footerText, { color: colors.background }]}>RELEASE NOTES / REUSE CONTEXT / PRESERVE LINKS / SHARE LESS CHAOS / MORE SIGNAL.</Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingTop: 10 },
  scroll: { flex: 1 },
  content: { gap: 0, paddingBottom: 110 },
  hero: { paddingHorizontal: 10, paddingTop: 22, paddingBottom: 23, gap: 0 },
  heroKicker: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.9, marginBottom: 12 },
  heroWord: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 42, letterSpacing: -1.6 },
  heroSubword: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 22, letterSpacing: 3.2, marginTop: 8 },
  heroHighlight: { alignSelf: 'flex-start', fontFamily: 'Inter_700Bold', fontSize: 40, lineHeight: 44, letterSpacing: -1.2, paddingHorizontal: 4, marginTop: 1 },
  heroBody: { maxWidth: 310, fontFamily: 'Inter_700Bold', fontSize: 9, lineHeight: 13, letterSpacing: 0.25, marginTop: 13 },
  threadHeading: { minHeight: 50, paddingHorizontal: 10, borderTopWidth: 1.5, borderBottomWidth: 1.5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  searchBar: { minHeight: 46, marginTop: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingLeft: 11, gap: 8 },
  searchText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 10 },
  loading: { minHeight: 160, justifyContent: 'center', alignItems: 'center' },
  conversationList: { gap: 0, paddingTop: 4 },
  statsRow: { flexDirection: 'row', borderTopWidth: 1.5, borderLeftWidth: 1.5, marginTop: 20 },
  statHalf: { flexBasis: '50%', flexGrow: 0, flexShrink: 0, width: '50%' },
  footer: { minHeight: 42, paddingHorizontal: 10, justifyContent: 'center', marginTop: 12 },
  footerText: { fontFamily: 'Inter_700Bold', fontSize: 7, lineHeight: 11, letterSpacing: 0.7 },
});