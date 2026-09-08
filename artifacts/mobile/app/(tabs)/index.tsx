import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppScreen, Chip, ConversationCard, EmptyState, ErrorNotice, IconButton, ScreenHeader, SectionLabel } from '@/components/ui';
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

  const conversations = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const error = libraryQuery.error instanceof Error ? libraryQuery.error.message : null;

  return (
    <AppScreen scroll={false}>
      <ScreenHeader
        eyebrow="01 / LIBRARY"
        title="Keep the thread."
        description="A quiet index of the context worth carrying forward."
        right={<IconButton icon="plus" label="Import conversation" onPress={() => router.push('/import')} />}
      />

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchText, styles.searchPressable, { color: colors.foreground }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your conversations"
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          returnKeyType="search"
          testID="conversation-search-input"
        />
        <IconButton icon={showFilters ? 'x' : 'sliders'} label={showFilters ? 'Close filters' : 'Open filters'} onPress={() => setShowFilters((visible) => !visible)} />
      </View>

      {showFilters ? (
        <View style={styles.filterRow}>
          {PROVIDERS.map((item) => (
            <Chip key={item} label={item} selected={provider === item} onPress={() => setProvider(item)} />
          ))}
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <SectionLabel>{query ? 'Search results' : 'Recent context'}</SectionLabel>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>{conversations.length} loaded</Text>
      </View>

      {libraryQuery.isLoading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <ErrorNotice message={error} onRetry={() => libraryQuery.refetch()} />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon="archive"
          title={query ? 'No matching context' : 'Your library is empty'}
          description={query ? 'Try a broader search or another provider.' : 'Import a transcript to give your next model a head start.'}
          action={<Chip label="IMPORT A TRANSCRIPT" selected onPress={() => router.push('/import')} />}
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationCard conversation={item} onPress={() => router.push(`/conversations/${item.id}`)} />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshing={libraryQuery.isRefetching}
          onRefresh={() => libraryQuery.refetch()}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  searchBar: { minHeight: 52, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, gap: 10 },
  searchPressable: { flex: 1, justifyContent: 'center' },
  searchText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  loading: { minHeight: 200, justifyContent: 'center', alignItems: 'center' },
  list: { paddingBottom: 120 },
});