import React, { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { ConversationSummary, HandoffSummary } from '@/services/lnkz-api';

export function AppScreen({
  children,
  scroll = true,
  style,
}: PropsWithChildren<{ scroll?: boolean; style?: StyleProp<ViewStyle> }>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const paddingBottom = Platform.OS === 'web' ? 34 : insets.bottom + 18;
  const contentStyle = [styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 18, paddingBottom }, style];

  if (!scroll) return <View style={contentStyle}>{children}</View>;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        { borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.55 : 1 },
      ]}
      testID={`icon-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Feather name={icon} size={18} color={destructive ? colors.destructive : colors.foreground} />
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.primary, opacity: disabled || loading ? 0.45 : pressed ? 0.78 : 1 },
        style,
      ]}
      testID={`button-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {loading ? <ActivityIndicator color={colors.primaryForeground} /> : null}
      {!loading && icon ? <Feather name={icon} size={17} color={colors.primaryForeground} /> : null}
      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.55 : 1 },
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={colors.foreground} /> : null}
      <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  multiline = false,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeading}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
      </View>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground },
          multiline && styles.multiline,
        ]}
      />
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const content = (
    <Text style={[styles.chipText, { color: selected ? colors.accentForeground : colors.mutedForeground }]}>{label}</Text>
  );
  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor: colors.secondary }]}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.accent : colors.secondary, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

export function SectionLabel({ children }: PropsWithChildren) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{children}</Text>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: colors.secondary, borderColor: colors.destructive }]}>
      <Feather name="alert-circle" size={17} color={colors.destructive} />
      <View style={styles.noticeCopy}>
        <Text style={[styles.noticeText, { color: colors.foreground }]}>{message}</Text>
        {onRetry ? <SecondaryButton label="Try again" onPress={onRetry} /> : null}
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[styles.empty, { borderColor: colors.input }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={24} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>{description}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function ConversationCard({
  conversation,
  onPress,
}: {
  conversation: ConversationSummary;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.conversationCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
      ]}
      testID={`conversation-${conversation.id}`}
    >
      <View style={styles.cardTopline}>
        <Text style={[styles.provider, { color: colors.primary }]}>{conversation.source.provider.toUpperCase()}</Text>
        <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>{formatDate(conversation.updatedAt)}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.cardTitle, { color: colors.foreground }]}>{conversation.title}</Text>
      {conversation.summary ? (
        <Text numberOfLines={2} style={[styles.cardSummary, { color: colors.mutedForeground }]}>{conversation.summary}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{conversation.messageCount} messages</Text>
        <Feather name="arrow-up-right" size={17} color={colors.foreground} />
      </View>
    </Pressable>
  );
}

export function HandoffCard({
  handoff,
  onRevoke,
}: {
  handoff: HandoffSummary;
  onRevoke: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.handoffCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTopline}>
        <Chip label={handoff.active ? 'ACTIVE' : 'EXPIRED'} selected={handoff.active} />
        <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>{formatDate(handoff.expiresAt)}</Text>
      </View>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{handoff.audience || 'Private handoff'}</Text>
      {handoff.note ? <Text style={[styles.cardSummary, { color: colors.mutedForeground }]}>{handoff.note}</Text> : null}
      <View style={styles.cardFooter}>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
          {handoff.uses}/{handoff.maxUses} uses · {handoff.redact ? 'redacted' : 'full context'}
        </Text>
        {handoff.active ? <IconButton icon="slash" label="Revoke handoff" onPress={onRevoke} destructive /> : null}
      </View>
    </View>
  );
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export const styles = StyleSheet.create({
  screen: { flexGrow: 1, paddingHorizontal: 20, gap: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerCopy: { flex: 1, gap: 6 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 34 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  iconButton: { width: 40, height: 40, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 50, paddingHorizontal: 18, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  primaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 14, letterSpacing: 0.2 },
  secondaryButton: { minHeight: 42, paddingHorizontal: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  secondaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  field: { gap: 8 },
  fieldHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.4 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  input: { minHeight: 48, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  multiline: { minHeight: 180, textAlignVertical: 'top' },
  chip: { minHeight: 32, paddingHorizontal: 11, justifyContent: 'center', alignItems: 'center' },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  notice: { flexDirection: 'row', gap: 10, padding: 13, borderWidth: 1.5 },
  noticeCopy: { flex: 1, gap: 10, alignItems: 'flex-start' },
  noticeText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10, borderWidth: 1.5, borderStyle: 'dashed' },
  emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  emptyDescription: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  emptyAction: { marginTop: 8 },
  conversationCard: { padding: 16, borderWidth: 1.5, gap: 10 },
  handoffCard: { padding: 16, borderWidth: 1.5, gap: 12 },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  provider: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.2 },
  cardDate: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22 },
  cardSummary: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardMeta: { fontFamily: 'Inter_500Medium', fontSize: 11 },
});