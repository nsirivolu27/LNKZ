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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { ConversationSummary, HandoffSummary, WorkspaceIdentity } from '@/services/lnkz-api';
import { getHandoffState } from '@/services/handoff-state';

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
  const router = useRouter();
  return (
    <>
      <FieldHandoffHeader
        onSend={() => router.push('/import')}
        onPacket={() => router.push('/build')}
        onHandoff={() => router.push('/handoffs')}
        onSettings={() => router.push('/settings')}
        onThread={() => router.push('/(tabs)')}
      />
      <View style={[styles.header, { borderColor: colors.border }]}>
        <View style={styles.headerCopy}>
          {eyebrow ? <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{eyebrow}</Text> : null}
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          {description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text> : null}
        </View>
        {right}
      </View>
    </>
  );
}

export function FieldHandoffHeader({
  onSend,
  onPacket,
  onHandoff,
  onSettings,
  onThread,
}: {
  onSend: () => void;
  onPacket: () => void;
  onHandoff: () => void;
  onSettings: () => void;
  onThread?: () => void;
}) {
  const colors = useColors();
  const navigation = [
    { number: '01', label: 'THE THREAD', onPress: onThread ?? (() => undefined) },
    { number: '02', label: 'THE PACKET', onPress: onPacket },
    { number: '03', label: 'THE DESTINATION', onPress: onHandoff },
    { number: '04', label: 'THE HANDOFF', onPress: onSettings },
  ];
  return (
    <View style={[styles.fieldHeader, { borderColor: colors.border }]}>
      <View style={[styles.fieldStrip, { backgroundColor: colors.foreground }]}>
        <Text style={[styles.fieldStripText, { color: colors.background }]}>KEEP THE CONTEXT — LOSE THE NOISE — PRIVATE HANDOFF — LNKZ —</Text>
      </View>
      <View style={styles.fieldIdentity}>
        <View style={styles.fieldBrand}>
          <View style={[styles.fieldMark, { borderColor: colors.foreground }]} />
          <View>
            <Text style={[styles.fieldBrandName, { color: colors.foreground }]}>LNKZ</Text>
            <Text style={[styles.fieldBrandMeta, { color: colors.mutedForeground }]}>CONTEXT RELAY · 1:1 · SHARE · PRIVATE BY DEFAULT</Text>
          </View>
        </View>
        <Pressable
          onPress={onSend}
          style={({ pressed }) => [styles.fieldSend, { backgroundColor: colors.accent, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Send context"
        >
          <Text style={[styles.fieldSendText, { color: colors.accentForeground }]}>SEND</Text>
          <Feather name="arrow-up-right" size={14} color={colors.accentForeground} />
        </Pressable>
      </View>
      <View style={[styles.fieldNav, { borderTopColor: colors.border }]}>
        {navigation.map((item) => (
          <Pressable
            key={item.number}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.fieldNavItem, { borderRightColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Text style={[styles.fieldNavNumber, { color: colors.mutedForeground }]}>{item.number}</Text>
            <Text style={[styles.fieldNavLabel, { color: colors.foreground }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function FieldHandoffStat({ label, value, style }: { label: string; value: string; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[styles.fieldStat, style, { borderColor: colors.border }]}>
      <Text style={[styles.fieldStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.fieldStatValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

export function WorkspaceIdentityCard({
  identity,
  loading = false,
  message,
  onRetry,
}: {
  identity?: WorkspaceIdentity;
  loading?: boolean;
  message?: string;
  onRetry?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.workspaceCard, { borderColor: colors.border }]}>
      <View style={styles.workspaceHeading}>
        <SectionLabel>AUTHENTICATED WORKSPACE</SectionLabel>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      {identity ? (
        <>
          <View style={styles.workspaceTitleRow}>
            <Text numberOfLines={1} style={[styles.workspaceName, { color: colors.foreground }]}>{identity.workspace.name}</Text>
            <Chip label={identity.workspace.mode.toUpperCase()} selected />
          </View>
          <Text style={[styles.workspaceUseCase, { color: colors.mutedForeground }]}>{identity.workspace.useCase}</Text>
          <View style={styles.workspaceDetails}>
            <Text style={[styles.workspaceDetail, { color: colors.foreground }]}>ACTOR <Text style={{ color: colors.mutedForeground }}>{identity.access.actorId}</Text></Text>
            <Text style={[styles.workspaceDetail, { color: colors.foreground }]}>SCOPES <Text style={{ color: colors.mutedForeground }}>{identity.access.scopes.join(' · ') || 'none'}</Text></Text>
          </View>
        </>
      ) : message ? (
        <View style={styles.workspaceMessage}>
          <Text style={[styles.workspaceUseCase, { color: colors.mutedForeground }]}>{message}</Text>
          {onRetry ? <SecondaryButton label="Retry identity" onPress={onRetry} /> : null}
        </View>
      ) : (
        <Text style={[styles.workspaceUseCase, { color: colors.mutedForeground }]}>Connect a relay to load workspace identity.</Text>
      )}
    </View>
  );
}

export function FieldHandoffPreview({ onImport }: { onImport: () => void }) {
  const colors = useColors();
  const rows = [
    { code: '01', title: 'Import a conversation', meta: 'ChatGPT · Claude · Gemini · Markdown · text', featured: true },
    { code: '02', title: 'Select useful context', meta: 'Choose the thread before building a bounded packet', featured: false },
    { code: '03', title: 'Share a private handoff', meta: 'Expiry · usage limits · redaction · revocation', featured: false },
  ];

  return (
    <View style={styles.fieldPreview}>
      <View style={styles.fieldPreviewRows}>
        {rows.map((row) => (
          <View
            key={row.title}
            style={[
              styles.fieldPreviewRow,
              { borderBottomColor: colors.border, backgroundColor: row.featured ? colors.foreground : 'transparent' },
            ]}
          >
            <Text style={[styles.fieldPreviewBullet, { color: row.featured ? colors.background : colors.foreground }]}>{row.featured ? '›' : '·'}</Text>
            <View style={[styles.fieldPreviewBadge, { backgroundColor: row.featured ? colors.background : colors.secondary }]}>
              <Text style={[styles.fieldPreviewBadgeText, { color: row.featured ? colors.foreground : colors.mutedForeground }]}>{row.code}</Text>
            </View>
            <View style={styles.fieldPreviewCopy}>
              <Text style={[styles.fieldPreviewTitle, { color: row.featured ? colors.background : colors.foreground }]}>{row.title}</Text>
              <Text style={[styles.fieldPreviewMeta, { color: row.featured ? colors.mutedForeground : colors.mutedForeground }]}>{row.meta}</Text>
            </View>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onImport}
        accessibilityRole="button"
        accessibilityLabel="Import a conversation"
        style={({ pressed }) => [styles.fieldPreviewImport, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Feather name="upload-cloud" size={16} color={colors.foreground} />
        <Text style={[styles.fieldPreviewImportText, { color: colors.foreground }]}>IMPORT A CONVERSATION</Text>
      </Pressable>
      <View style={styles.fieldPreviewStats}>
        <FieldHandoffStat label="AUTH" value="BEARER" style={styles.fieldStatHalf} />
        <FieldHandoffStat label="STORAGE" value="SECURE" style={styles.fieldStatHalf} />
        <FieldHandoffStat label="LINKS" value="EXPIRING" style={styles.fieldStatHalf} />
        <FieldHandoffStat label="STATE" value="LIVE" style={styles.fieldStatHalf} />
      </View>
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
        { backgroundColor: colors.foreground, opacity: disabled || loading ? 0.45 : pressed ? 0.78 : 1 },
        style,
      ]}
      testID={`button-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {loading ? <ActivityIndicator color={colors.background} /> : null}
      {!loading && icon ? <Feather name={icon} size={17} color={colors.background} /> : null}
      <Text style={[styles.primaryButtonText, { color: colors.background }]}>{label}</Text>
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
      accessibilityRole="button"
      accessibilityLabel={label}
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
  const title = conversation.title.replace(/\\n|\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.conversationCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
      ]}
      testID={`conversation-${conversation.id}`}
    >
      <View style={[styles.providerBadge, { backgroundColor: colors.secondary }]}>
        <Text style={[styles.providerBadgeText, { color: colors.primary }]}>{conversation.source.provider.slice(0, 2).toUpperCase()}</Text>
      </View>
      <View style={styles.cardContent}>
        <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.cardSummary, { color: colors.mutedForeground }]}>
          {conversation.source.provider.toUpperCase()} · {conversation.messageCount} MESSAGES · {formatDate(conversation.updatedAt)}
        </Text>
      </View>
      <Feather name="arrow-up-right" size={16} color={colors.foreground} />
    </Pressable>
  );
}

export function HandoffCard({
  handoff,
  onRevoke,
  revokeDisabled = false,
}: {
  handoff: HandoffSummary;
  onRevoke: () => void;
  revokeDisabled?: boolean;
}) {
  const colors = useColors();
  const state = getHandoffState(handoff);
  return (
    <View style={[styles.handoffCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTopline}>
        <Chip label={state.toUpperCase()} selected={state === 'active'} />
        <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>expires {formatDate(handoff.expiresAt)}</Text>
      </View>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{handoff.audience || 'Private handoff'}</Text>
      {handoff.note ? <Text style={[styles.cardSummary, { color: colors.mutedForeground }]}>{handoff.note}</Text> : null}
      <View style={styles.cardFooter}>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
          created {formatDate(handoff.createdAt)} · {handoff.uses}/{handoff.maxUses} uses · {handoff.redact ? 'redacted' : 'full context'}
        </Text>
        {state === 'active' ? <IconButton icon="slash" label="Revoke handoff" onPress={onRevoke} disabled={revokeDisabled} destructive /> : null}
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
  screen: { flexGrow: 1, paddingHorizontal: 12, gap: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingHorizontal: 10, paddingVertical: 4, borderBottomWidth: 1.5 },
  headerCopy: { flex: 1, gap: 7 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.2 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, lineHeight: 34, letterSpacing: -0.8 },
  description: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, letterSpacing: 0.15 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  iconButton: { width: 40, height: 40, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  primaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase' },
  secondaryButton: { minHeight: 42, paddingHorizontal: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  secondaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  field: { gap: 8 },
  fieldHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.4 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  input: { minHeight: 48, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  multiline: { minHeight: 180, textAlignVertical: 'top' },
  chip: { minHeight: 32, paddingHorizontal: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  notice: { flexDirection: 'row', gap: 10, padding: 13, borderWidth: 1.5 },
  noticeCopy: { flex: 1, gap: 10, alignItems: 'flex-start' },
  noticeText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10, borderWidth: 1.5, borderStyle: 'dashed' },
  emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  emptyDescription: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  emptyAction: { marginTop: 8 },
  conversationCard: { minHeight: 56, paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: 10 },
  providerBadge: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  providerBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  cardContent: { flex: 1, gap: 3 },
  handoffCard: { padding: 14, borderWidth: 1.5, gap: 12 },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  provider: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.2 },
  cardDate: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22 },
  cardSummary: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardMeta: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  fieldHeader: { borderWidth: 1.5, backgroundColor: 'transparent' },
  fieldStrip: { minHeight: 16, paddingHorizontal: 8, justifyContent: 'center' },
  fieldStripText: { fontFamily: 'Inter_700Bold', fontSize: 7, letterSpacing: 0.8 },
  fieldIdentity: { minHeight: 70, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  fieldBrand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  fieldMark: { width: 12, height: 12, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  fieldBrandName: { fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: 0.8 },
  fieldBrandMeta: { fontFamily: 'Inter_500Medium', fontSize: 7, letterSpacing: 0.4, marginTop: 2 },
  fieldSend: { minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, borderLeftWidth: 1.5 },
  fieldSendText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  fieldNav: { flexDirection: 'row', borderTopWidth: 1.5 },
  fieldNavItem: { flex: 1, minHeight: 48, padding: 7, justifyContent: 'space-between', borderRightWidth: 1.5 },
  fieldNavNumber: { fontFamily: 'Inter_700Bold', fontSize: 8 },
  fieldNavLabel: { fontFamily: 'Inter_700Bold', fontSize: 8, lineHeight: 10 },
  fieldStat: { flex: 1, padding: 10, minHeight: 57, justifyContent: 'space-between', borderRightWidth: 1.5 },
  fieldStatHalf: { flexBasis: '50%', flexGrow: 0, flexShrink: 0, width: '50%' },
  fieldStatLabel: { fontFamily: 'Inter_700Bold', fontSize: 7, letterSpacing: 0.8 },
  fieldStatValue: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  fieldPreview: { marginTop: 8 },
  fieldPreviewRows: { borderTopWidth: 1.5 },
  fieldPreviewRow: { minHeight: 55, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1.5 },
  fieldPreviewBullet: { width: 10, fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  fieldPreviewBadge: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  fieldPreviewBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 7 },
  fieldPreviewCopy: { flex: 1, gap: 3 },
  fieldPreviewTitle: { fontFamily: 'Inter_700Bold', fontSize: 11, lineHeight: 14 },
  fieldPreviewMeta: { fontFamily: 'Inter_500Medium', fontSize: 8 },
  fieldPreviewImport: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1.5, paddingHorizontal: 8 },
  fieldPreviewImportText: { fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  fieldPreviewStats: { flexDirection: 'row', flexWrap: 'wrap', borderLeftWidth: 1.5, borderTopWidth: 1.5, borderColor: 'transparent' },
  workspaceCard: { marginTop: 12, padding: 10, borderWidth: 1.5, gap: 7 },
  workspaceHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workspaceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workspaceName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 21 },
  workspaceUseCase: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  workspaceDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 3 },
  workspaceDetail: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.4 },
  workspaceMessage: { gap: 9, alignItems: 'flex-start' },
});