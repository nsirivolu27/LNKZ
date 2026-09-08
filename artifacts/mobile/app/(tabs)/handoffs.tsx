import React from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppScreen, EmptyState, ErrorNotice, HandoffCard, IconButton, ScreenHeader, SectionLabel } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/services/lnkz-api';
import { useColors } from '@/hooks/useColors';

export default function HandoffsScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { api } = useApp();
  const handoffsQuery = useQuery({
    queryKey: ['handoffs'],
    enabled: Boolean(api),
    queryFn: async () => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      return (await api.listHandoffs()).handoffs;
    },
  });
  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!api) throw new ApiError('Connect to a relay first.', 0);
      await api.revokeHandoff(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['handoffs'] }),
  });

  function revoke(id: string) {
    Alert.alert('Revoke this handoff?', 'Anyone with the link will lose access immediately.', [
      { text: 'Keep link', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => revokeMutation.mutate(id) },
    ]);
  }

  const handoffs = handoffsQuery.data ?? [];
  return (
    <AppScreen scroll={false}>
      <ScreenHeader
        eyebrow="03 / THE HANDOFF"
        title="What’s in motion."
        description="Active links are intentionally visible. Revoke anything that has served its purpose."
        right={<IconButton icon="plus" label="Choose a conversation" onPress={() => router.push('/(tabs)')} />}
      />
      <View style={styles.summary}>
        <SectionLabel>ACTIVE LINKS</SectionLabel>
        <Text style={[styles.activeCount, { color: colors.primary }]}>{handoffs.filter((handoff) => handoff.active).length}</Text>
      </View>
      {handoffsQuery.isLoading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : handoffsQuery.error ? (
        <ErrorNotice message={handoffsQuery.error instanceof Error ? handoffsQuery.error.message : 'Could not load handoffs.'} onRetry={() => handoffsQuery.refetch()} />
      ) : handoffs.length === 0 ? (
        <EmptyState icon="link" title="No handoffs yet" description="Create a private, expiring link from any conversation detail screen." />
      ) : (
        <FlatList
          data={handoffs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <HandoffCard handoff={item} onRevoke={() => revoke(item.id)} />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={handoffsQuery.isRefetching}
          onRefresh={() => handoffsQuery.refetch()}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50, paddingHorizontal: 10, borderTopWidth: 1.5, borderBottomWidth: 1.5 },
  activeCount: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.8 },
  loading: { minHeight: 180, justifyContent: 'center', alignItems: 'center' },
  list: { paddingBottom: 120 },
});