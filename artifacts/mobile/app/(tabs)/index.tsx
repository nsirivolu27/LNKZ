import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const libraryQuery = useQuery({
    queryKey: ['conversations', searchQuery, provider],
    enabled: Boolean(api),
    queryFn: async ({ signal }) => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      if (searchQuery) {
        const result = await api.searchConversations(searchQuery, signal);
        return result.matches as ConversationSummary[];
      }
      const result = await api.listConversations({ provider: provider === 'all' ? undefined : provider }, signal);
      return result.conversations;
    },
  });
  const statsQuery = useQuery({
    queryKey: ['stats'],
    enabled: Boolean(api),
    queryFn: async ({ signal }) => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return api.stats(signal);
    },
  });
  const connectorsQuery = useQuery({
    queryKey: ['connectors'],
    enabled: Boolean(api),
    queryFn: async ({ signal }) => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return api.connectors(signal);
    },
  });

  const conversations = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const messageCount = conversations.reduce((total, item) => total + item.messageCount, 0);
  const stats = statsQuery.data?.stats;
  const connectedSources = connectorsQuery.data?.connectors.filter((connector) => connector.configured).length ?? 0;
  const error = libraryQuery.error instanceof Error ? libraryQuery.error.message : null;
  const refreshing = libraryQuery.isRefetching || statsQuery.isRefetching || connectorsQuery.isRefetching;

  return (
    <AppScreen scroll={false} style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void Promise.all([
                libraryQuery.refetch(),
                statsQuery.refetch(),
                connectorsQuery.refetch(),
              ]);
            }}
            tintColor={colors.primary}
          />
        )}
      >
        <FieldHandoffHeader
          onSend={() => router.push('/import')}
          onPacket={() => router.push('/build')}
          onHandoff={() => router.push('/handoffs')}
          onSettings={() => router.push('/settings')}
          onThread={() => router.push('/(tabs)')}
        />

        <View style={[styles.statsRow, { borderColor: colors.border }]}>
          <FieldHandoffStat label="THREADS" value={statsQuery.isLoading ? '…' : String(stats?.conversations ?? conversations.length)} style={styles.statQuarter} />
          <FieldHandoffStat label="MESSAGES" value={statsQuery.isLoading ? '…' : (stats?.messages ?? messageCount).toLocaleString()} style={styles.statQuarter} />
          <FieldHandoffStat label="HANDOFFS" value={statsQuery.isLoading ? '…' : String(stats?.activeHandoffs ?? 0)} style={styles.statQuarter} />
          <FieldHandoffStat label="SOURCES" value={connectorsQuery.isLoading ? '…' : String(connectedSources)} style={styles.statQuarter} />
        </View>

        <View style={[styles.toolbar, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.toolbarInput}>
            <Feather name="terminal" size={14} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchText, { color: colors.foreground }]}
              value={query}
              onChangeText={setQuery}
              placeholder="SEARCH_INDEX"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              returnKeyType="search"
              testID="conversation-search-input"
            />
          </View>
          <View style={styles.toolbarActions}>
            <SecondaryButton label="IMPORT" onPress={() => router.push('/import')} />
            <Chip label={showFilters ? 'HIDE' : 'FLTR'} selected={showFilters} onPress={() => setShowFilters((visible) => !visible)} />
          </View>
        </View>

        {showFilters ? (
          <View style={styles.filterRow}>
            {PROVIDERS.map((item) => (
              <Chip key={item} label={item.toUpperCase()} selected={provider === item} onPress={() => setProvider(item)} />
            ))}
          </View>
        ) : null}

        {libraryQuery.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <ErrorNotice message={error} onRetry={() => libraryQuery.refetch()} />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon="database"
            title={query ? 'NO_MATCHING_RECORDS' : 'INDEX_EMPTY'}
            description={query ? 'Try a broader search or another provider.' : 'Import a transcript to initialize local index.'}
            action={<Chip label="IMPORT_TRANSCRIPT" selected onPress={() => router.push('/import')} />}
          />
        ) : (
          <View style={styles.conversationList}>
            {conversations.map((conversation) => (
              <ConversationCard key={conversation.id} conversation={conversation} onPress={() => router.push(`/conversations/${conversation.id}`)} />
            ))}
          </View>
        )}

        <View style={[styles.sourcesPanel, { borderColor: colors.border }]}>
          <View style={styles.sourcesHeading}>
            <SectionLabel>CONNECTOR STATUS</SectionLabel>
            {connectorsQuery.error ? <SecondaryButton label="Retry" onPress={() => connectorsQuery.refetch()} /> : null}
          </View>
          {connectorsQuery.isLoading ? (
            <View style={styles.sourceLoading}><ActivityIndicator color={colors.primary} /></View>
          ) : connectorsQuery.error ? (
            <ErrorNotice message={connectorsQuery.error instanceof Error ? connectorsQuery.error.message : 'Could not load source status.'} onRetry={() => connectorsQuery.refetch()} />
          ) : connectorsQuery.data?.connectors.length ? (
            <View style={styles.sourcesList}>
              {connectorsQuery.data.connectors.map((connector) => (
                <View key={connector.id} style={[styles.sourceRow, { borderColor: colors.input }]}>
                  <View style={styles.sourceCopy}>
                    <Text style={[styles.sourceLabel, { color: colors.foreground }]}>{connector.label}</Text>
                    <Text numberOfLines={1} style={[styles.sourceDetail, { color: colors.mutedForeground }]}>{connector.detail}</Text>
                  </View>
                  <Chip label={connector.configured ? 'READY' : 'OFF'} selected={connector.configured} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.sourceEmpty, { color: colors.mutedForeground }]}>No connectors are configured on this relay yet.</Text>
          )}
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
  toolbar: { minHeight: 46, marginTop: 16, borderBottomWidth: 1.5, borderTopWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8, gap: 12 },
  toolbarInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 10 },
  sourcesPanel: { marginTop: 16, padding: 10, borderWidth: 1.5, gap: 10 },
  sourcesHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  sourceLoading: { minHeight: 36, justifyContent: 'center', alignItems: 'center' },
  sourcesList: { gap: 0 },
  sourceRow: { minHeight: 42, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  sourceCopy: { flex: 1, gap: 2 },
  sourceLabel: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  sourceDetail: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  sourceEmpty: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  loading: { minHeight: 160, justifyContent: 'center', alignItems: 'center' },
  conversationList: { gap: 0, paddingTop: 4 },
  statsRow: { flexDirection: 'row', borderLeftWidth: 1.5, marginTop: 16, borderBottomWidth: 1.5, borderTopWidth: 1.5 },
  statQuarter: { flexBasis: '25%', flexGrow: 0, flexShrink: 0, width: '25%', paddingHorizontal: 6, minHeight: 46 },
  statHalf: { flexBasis: '50%', flexGrow: 0, flexShrink: 0, width: '50%' },
  footer: { minHeight: 42, paddingHorizontal: 10, justifyContent: 'center', marginTop: 16, marginBottom: 20 },
  footerText: { fontFamily: 'Inter_700Bold', fontSize: 7, lineHeight: 11, letterSpacing: 0.7 },
});