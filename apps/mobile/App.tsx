import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  LnkzClient,
  messageOf,
  normalizeBaseUrl,
  type Analysis,
  type ConnectorStatus,
  type Conversation,
  type ConversationSummary,
  type HandoffSummary,
  type IssuedHandoff,
  type Packet,
  type Stats,
} from "./src/api";
import { clearConnection, loadConnection, saveConnection, type StoredConnection } from "./src/storage";

type Tab = "home" | "library" | "import" | "handoffs" | "settings";

const TABS: { id: Tab; label: string; mark: string }[] = [
  { id: "home", label: "HOME", mark: "01" },
  { id: "library", label: "LIBRARY", mark: "02" },
  { id: "import", label: "IMPORT", mark: "03" },
  { id: "handoffs", label: "HANDOFFS", mark: "04" },
  { id: "settings", label: "SETTINGS", mark: "05" },
];

const DEFAULT_URL = process.env.EXPO_PUBLIC_LNKZ_API_URL ?? "http://localhost:3100";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [connection, setConnection] = useState<StoredConnection | null>(null);

  useEffect(() => {
    loadConnection()
      .then(setConnection)
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={styles.boot}>
        <StatusBar style="dark" />
        <ActivityIndicator color="#0b0c0b" />
        <Text style={styles.mono}>RESTORING YOUR RELAY</Text>
      </SafeAreaView>
    );
  }

  if (!connection) {
    return <ConnectionScreen onConnected={setConnection} />;
  }

  return <RelayApp connection={connection} onDisconnect={() => setConnection(null)} />;
}

function ConnectionScreen({ onConnected }: { onConnected: (connection: StoredConnection) => void }) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const normalized = normalizeBaseUrl(baseUrl);
      const candidate = { baseUrl: normalized, apiKey: apiKey.trim() };
      await new LnkzClient(candidate.baseUrl, candidate.apiKey).stats();
      await saveConnection(candidate);
      onConnected(candidate);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.ticker}><Text style={styles.tickerText}>★ KEEP THE CONTEXT · LOSE THE NOISE · PRIVATE BY DEFAULT</Text></View>
      <ScrollView contentContainerStyle={styles.connectionPage} keyboardShouldPersistTaps="handled">
        <Text style={styles.brandMark}>△</Text>
        <Text style={styles.connectionTitle}>LNKZ</Text>
        <Text style={styles.eyebrow}>CONNECT / YOUR RELAY / ONE SECURE KEY</Text>
        <Text style={styles.hero}>YOUR CONTEXT.{"\n"}<Text style={styles.highlight}>READY TO MOVE.</Text></Text>
        <Text style={styles.copy}>Connect this phone to the LNKZ relay that stores your conversations and creates private handoffs.</Text>
        <Field label="SERVER URL" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" keyboardType="url" />
        <Field label="API KEY" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Action label={busy ? "TESTING CONNECTION…" : "CONNECT TO LNKZ →"} onPress={connect} disabled={busy} />
        <Text style={styles.hint}>The API key is stored in the device keychain. Web preview uses this browser’s local storage.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function RelayApp({ connection, onDisconnect }: { connection: StoredConnection; onDisconnect: () => void }) {
  const client = useMemo(() => new LnkzClient(connection.baseUrl, connection.apiKey), [connection]);
  const [tab, setTab] = useState<Tab>("home");
  const [stats, setStats] = useState<Stats | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ conversation: Conversation; analysis: Analysis } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      client.stats(),
      client.connectors(),
      client.listConversations(),
      client.listHandoffs(),
    ]);
    if (results[0].status === "fulfilled") setStats(results[0].value.stats);
    if (results[1].status === "fulfilled") setConnectors(results[1].value.connectors);
    if (results[2].status === "fulfilled") setConversations(results[2].value.conversations);
    if (results[3].status === "fulfilled") setHandoffs(results[3].value.handoffs);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(messageOf(failure.reason));
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [client]);

  const openConversation = async (id: string) => {
    setBusy("conversation");
    setError("");
    try {
      setSelectedId(id);
      setSelected(await client.getConversation(id));
      setTab("library");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  const selectTab = (next: Tab) => {
    setNotice("");
    setError("");
    setTab(next);
  };

  const disconnect = async () => {
    await clearConnection();
    onDisconnect();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.ticker}><Text style={styles.tickerText}>★ KEEP THE CONTEXT · LOSE THE NOISE · PRIVATE HANDOFF · LNKZ</Text></View>
      <View style={styles.header}>
        <View><Text style={styles.headerBrand}>△ LNKZ</Text><Text style={styles.headerMeta}>CONTEXT RELAY · PRIVATE BY DEFAULT</Text></View>
        <Pressable style={styles.refreshButton} onPress={() => void refresh()}><Text style={styles.refreshText}>↻ SYNC</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>
        {TABS.map((item) => (
          <Pressable key={item.id} style={[styles.navItem, tab === item.id && styles.navItemActive]} onPress={() => selectTab(item.id)}>
            <Text style={[styles.navIndex, tab === item.id && styles.navActiveText]}>{item.mark}</Text>
            <Text style={[styles.navLabel, tab === item.id && styles.navActiveText]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color="#0b0c0b" style={styles.loader} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {tab === "home" && <Home stats={stats} conversations={conversations} onOpen={openConversation} onTab={selectTab} />}
        {tab === "library" && (
          <Library client={client} conversations={conversations} selected={selected} selectedId={selectedId} busy={busy} onOpen={openConversation} />
        )}
        {tab === "import" && (
          <ImportView
            client={client}
            busy={busy}
            setBusy={setBusy}
            onImported={async (conversation) => {
              setNotice(`Imported “${conversation.title}”.`);
              await refresh();
              await openConversation(conversation.id);
            }}
            setError={setError}
          />
        )}
        {tab === "handoffs" && (
          <HandoffsView
            client={client}
            conversations={conversations}
            handoffs={handoffs}
            selectedId={selectedId}
            onSelect={setSelectedId}
            refresh={refresh}
            setError={setError}
            setNotice={setNotice}
          />
        )}
        {tab === "settings" && (
          <SettingsView connection={connection} stats={stats} connectors={connectors} client={client} disconnect={disconnect} setError={setError} setNotice={setNotice} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Home({ stats, conversations, onOpen, onTab }: {
  stats: Stats | null;
  conversations: ConversationSummary[];
  onOpen: (id: string) => Promise<void>;
  onTab: (tab: Tab) => void;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>RELAY / LIVE WORKSPACE / READY WHEN YOU ARE</Text>
      <Text style={styles.hero}><Text style={styles.crossed}>NOISE.</Text>{"\n"}IS NOW{"\n"}<Text style={styles.highlight}>USEFUL.</Text></Text>
      <Text style={styles.copy}>Import a conversation, inspect what matters, and make one private handoff.</Text>
      <View style={styles.statsGrid}>
        <Stat label="THREADS" value={stats?.conversations ?? 0} />
        <Stat label="MESSAGES" value={stats?.messages ?? 0} />
        <Stat label="ACTIVE LINKS" value={stats?.activeHandoffs ?? 0} />
        <Stat label="SOURCES" value={stats?.providers.length ?? 0} />
      </View>
      <SectionTitle>RECENT CONVERSATIONS</SectionTitle>
      {conversations.slice(0, 4).map((item, index) => <ConversationRow key={item.id} item={item} index={index + 1} onPress={() => void onOpen(item.id)} />)}
      {!conversations.length ? <Empty>Nothing here yet. Import your first conversation.</Empty> : null}
      <View style={styles.buttonRow}>
        <Action label="IMPORT" onPress={() => onTab("import")} secondary />
        <Action label="CREATE HANDOFF →" onPress={() => onTab("handoffs")} />
      </View>
    </View>
  );
}

function Library({ client, conversations, selected, selectedId, busy, onOpen }: {
  client: LnkzClient;
  conversations: ConversationSummary[];
  selected: { conversation: Conversation; analysis: Analysis } | null;
  selectedId: string | null;
  busy: string;
  onOpen: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSummary[]>(conversations);
  const [searching, setSearching] = useState(false);

  useEffect(() => { if (!query.trim()) setResults(conversations); }, [conversations, query]);

  const search = async () => {
    if (!query.trim()) { setResults(conversations); return; }
    setSearching(true);
    try { setResults((await client.searchConversations(query.trim())).matches); }
    finally { setSearching(false); }
  };

  return (
    <View>
      <Text style={styles.eyebrow}>LIBRARY / SAVED THREADS / SEARCHABLE CONTEXT</Text>
      <Text style={styles.pageTitle}>THE THREAD.</Text>
      <Field label="SEARCH" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => void search()} placeholder="Decisions, topics, people…" />
      <Action label={searching ? "SEARCHING…" : "SEARCH LIBRARY"} onPress={search} secondary disabled={searching} />
      <View style={styles.divider} />
      {results.map((item, index) => (
        <ConversationRow key={item.id} item={item} index={index + 1} selected={selectedId === item.id} onPress={() => void onOpen(item.id)} />
      ))}
      {!results.length ? <Empty>No matching conversations.</Empty> : null}
      {busy === "conversation" ? <ActivityIndicator color="#0b0c0b" /> : null}
      {selected ? <ConversationDetail value={selected} /> : null}
    </View>
  );
}

function ConversationDetail({ value }: { value: { conversation: Conversation; analysis: Analysis } }) {
  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailLabel}>SELECTED THREAD</Text>
      <Text style={styles.detailTitle}>{value.conversation.title}</Text>
      <Text style={styles.meta}>{value.conversation.source.provider} · {value.analysis.approxTokens} APPROX TOKENS</Text>
      <ClaimList title="DECISIONS" values={value.analysis.decisions.map((item) => item.text)} />
      <ClaimList title="OPEN QUESTIONS" values={value.analysis.openQuestions.map((item) => item.text)} />
      <SectionTitle>TRANSCRIPT</SectionTitle>
      {value.conversation.messages.map((message) => (
        <View key={message.id} style={[styles.message, message.role === "assistant" && styles.assistantMessage]}>
          <Text style={styles.messageRole}>{message.author || message.role}</Text>
          <Text style={styles.messageText}>{message.content}</Text>
        </View>
      ))}
    </View>
  );
}

function ImportView({ client, busy, setBusy, onImported, setError }: {
  client: LnkzClient;
  busy: string;
  setBusy: (value: string) => void;
  onImported: (conversation: ConversationSummary) => Promise<void>;
  setError: (value: string) => void;
}) {
  const [payload, setPayload] = useState("");
  const [tags, setTags] = useState("");

  const run = async () => {
    if (!payload.trim()) { setError("Paste a conversation first."); return; }
    setBusy("import");
    setError("");
    try {
      const result = await client.importText(payload.trim(), "auto", tags.split(",").map((tag) => tag.trim()).filter(Boolean));
      const conversation = result.conversations[0];
      if (!conversation) throw new Error("The server did not return an imported conversation.");
      setPayload("");
      setTags("");
      await onImported(conversation);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  return (
    <View>
      <Text style={styles.eyebrow}>IMPORT / PASTE THE USEFUL PART / SAVED TO YOUR RELAY</Text>
      <Text style={styles.pageTitle}>BRING IT{"\n"}<Text style={styles.highlight}>WITH YOU.</Text></Text>
      <Field label="TAGS (OPTIONAL)" value={tags} onChangeText={setTags} placeholder="research, launch" />
      <Text style={styles.fieldLabel}>CONVERSATION OR EXPORT</Text>
      <TextInput multiline textAlignVertical="top" style={styles.textarea} value={payload} onChangeText={setPayload} placeholder="Paste ChatGPT, Claude, Gemini, Markdown, JSON, or plain text…" placeholderTextColor="#77776f" />
      <Text style={styles.hint}>LNKZ detects the format and preserves the original message order.</Text>
      <Action label={busy === "import" ? "IMPORTING…" : "IMPORT CONVERSATION →"} onPress={run} disabled={busy === "import"} />
    </View>
  );
}

function HandoffsView({ client, conversations, handoffs, selectedId, onSelect, refresh, setError, setNotice }: {
  client: LnkzClient;
  conversations: ConversationSummary[];
  handoffs: HandoffSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  refresh: () => Promise<void>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [ttl, setTtl] = useState("60");
  const [uses, setUses] = useState("3");
  const [audience, setAudience] = useState("");
  const [redact, setRedact] = useState(true);
  const [issued, setIssued] = useState<IssuedHandoff | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [working, setWorking] = useState("");

  const chosen = conversations.find((item) => item.id === selectedId) ?? conversations[0];

  const buildPacket = async () => {
    if (!chosen) return;
    setWorking("packet"); setError("");
    try { setPacket((await client.buildPacket([chosen.id])).packet); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(""); }
  };

  const create = async () => {
    if (!chosen) { setError("Import or select a conversation first."); return; }
    setWorking("handoff"); setError("");
    try {
      const result = await client.createHandoff(chosen.id, {
        ttlMinutes: Number(ttl) || 60,
        maxUses: Number(uses) || 3,
        audience: audience.trim() || undefined,
        redact,
      });
      setIssued(result);
      setNotice("Private handoff created.");
      await refresh();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(""); }
  };

  const share = async (value: string) => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      setNotice("Handoff link copied.");
      return;
    }
    await Share.share({ message: value });
  };

  const revoke = async (id: string) => {
    setWorking(id); setError("");
    try { await client.revokeHandoff(id); setNotice("Handoff revoked."); await refresh(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(""); }
  };

  return (
    <View>
      <Text style={styles.eyebrow}>HANDOFF / BOUNDED CONTEXT / EXPIRING ACCESS</Text>
      <Text style={styles.pageTitle}>MAKE THE{"\n"}<Text style={styles.highlight}>HANDOFF.</Text></Text>
      <SectionTitle>1 · CHOOSE THE THREAD</SectionTitle>
      {conversations.map((item, index) => (
        <ConversationRow key={item.id} item={item} index={index + 1} selected={chosen?.id === item.id} onPress={() => { onSelect(item.id); setIssued(null); setPacket(null); }} />
      ))}
      {!chosen ? <Empty>Import a conversation before creating a handoff.</Empty> : null}
      {chosen ? (
        <>
          <SectionTitle>2 · REVIEW THE PACKET</SectionTitle>
          <Action label={working === "packet" ? "BUILDING…" : "BUILD CONTEXT PACKET"} onPress={buildPacket} secondary disabled={Boolean(working)} />
          {packet ? <View style={styles.packet}><Text style={styles.meta}>{packet.usedTokens} / {packet.budgetTokens} TOKENS</Text><Text style={styles.packetText}>{packet.markdown}</Text></View> : null}
          <SectionTitle>3 · SET THE BOUNDARY</SectionTitle>
          <Field label="AUDIENCE" value={audience} onChangeText={setAudience} placeholder="Claude · My space" />
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="EXPIRES IN MINUTES" value={ttl} onChangeText={setTtl} keyboardType="number-pad" /></View>
            <View style={styles.fieldHalf}><Field label="MAX USES" value={uses} onChangeText={setUses} keyboardType="number-pad" /></View>
          </View>
          <View style={styles.switchRow}><View><Text style={styles.switchTitle}>REDACT SENSITIVE TEXT</Text><Text style={styles.hint}>Remove emails, secrets, and bearer tokens.</Text></View><Switch value={redact} onValueChange={setRedact} trackColor={{ false: "#b8b5ac", true: "#719068" }} /></View>
          <Action label={working === "handoff" ? "CREATING…" : "CREATE PRIVATE HANDOFF →"} onPress={create} disabled={Boolean(working)} />
          {issued ? <View style={styles.successCard}><Text style={styles.detailLabel}>EXPIRING HANDOFF LINK</Text><Text selectable style={styles.link}>{issued.shareUrl}</Text><Action label="COPY OR SHARE LINK" onPress={() => void share(issued.shareUrl)} secondary /></View> : null}
        </>
      ) : null}
      <SectionTitle>ISSUED HANDOFFS</SectionTitle>
      {handoffs.map((handoff) => (
        <View key={handoff.id} style={styles.handoffRow}>
          <View style={styles.flex}><Text style={styles.rowTitle}>{handoff.audience || "PRIVATE LINK"}</Text><Text style={styles.meta}>{handoff.active ? "ACTIVE" : handoff.revokedAt ? "REVOKED" : "EXPIRED OR SPENT"} · {handoff.uses}/{handoff.maxUses} USES · {shortDate(handoff.expiresAt)}</Text></View>
          {handoff.active ? <Pressable style={styles.revokeButton} onPress={() => void revoke(handoff.id)} disabled={working === handoff.id}><Text style={styles.revokeText}>REVOKE</Text></Pressable> : null}
        </View>
      ))}
      {!handoffs.length ? <Empty>No handoffs issued yet.</Empty> : null}
    </View>
  );
}

function SettingsView({ connection, stats, connectors, client, disconnect, setError, setNotice }: {
  connection: StoredConnection;
  stats: Stats | null;
  connectors: ConnectorStatus[];
  client: LnkzClient;
  disconnect: () => Promise<void>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const retest = async () => {
    setTesting(true); setError("");
    try { await client.stats(); setNotice("Connection verified."); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setTesting(false); }
  };
  return (
    <View>
      <Text style={styles.eyebrow}>SETTINGS / CONNECTION / CONNECTOR READINESS</Text>
      <Text style={styles.pageTitle}>YOUR RELAY.</Text>
      <View style={styles.detailCard}><Text style={styles.detailLabel}>SERVER</Text><Text selectable style={styles.link}>{connection.baseUrl}</Text><Text style={styles.meta}>{stats ? "CONNECTED" : "STATUS UNKNOWN"}</Text></View>
      <Action label={testing ? "TESTING…" : "RETEST CONNECTION"} onPress={retest} secondary disabled={testing} />
      <SectionTitle>CONNECTED SOURCES</SectionTitle>
      {connectors.map((connector) => (
        <View key={connector.id} style={styles.connectorRow}>
          <View style={[styles.dot, connector.configured && styles.dotOn]} />
          <View style={styles.flex}><Text style={styles.rowTitle}>{connector.label}</Text><Text style={styles.meta}>{connector.detail}</Text></View>
        </View>
      ))}
      <View style={styles.divider} />
      <Pressable style={styles.disconnectButton} onPress={() => void disconnect()}><Text style={styles.disconnectText}>DISCONNECT THIS DEVICE</Text></Pressable>
      <Text style={styles.hint}>Disconnecting clears the saved server URL and API key from this device.</Text>
    </View>
  );
}

function ConversationRow({ item, index, selected, onPress }: { item: ConversationSummary; index: number; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.conversationRow, selected && styles.conversationSelected]} onPress={onPress}>
      <Text style={styles.rowIndex}>{String(index).padStart(2, "0")}</Text>
      <View style={styles.sourceBadge}><Text style={styles.sourceText}>{item.source.provider.slice(0, 2).toUpperCase()}</Text></View>
      <View style={styles.flex}><Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text><Text style={styles.meta}>{item.messageCount} MESSAGES · {shortDate(item.updatedAt)}</Text></View>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
  );
}

function Field(props: ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...inputProps } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#77776f" style={[styles.input, style]} {...inputProps} /></View>;
}

function Action({ label, onPress, secondary, disabled }: { label: string; onPress: () => void | Promise<void>; secondary?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.action, secondary && styles.actionSecondary, disabled && styles.disabled]} onPress={() => void onPress()} disabled={disabled}><Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>{label}</Text></Pressable>;
}

function Notice({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return <View style={[styles.notice, tone === "error" && styles.errorNotice]}><Text style={styles.noticeText}>{children}</Text></View>;
}

function SectionTitle({ children }: { children: ReactNode }) { return <Text style={styles.sectionTitle}>{children}</Text>; }
function Empty({ children }: { children: ReactNode }) { return <Text style={styles.empty}>{children}</Text>; }
function Stat({ label, value }: { label: string; value: number }) { return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function ClaimList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <View><SectionTitle>{title}</SectionTitle>{values.slice(0, 5).map((value, index) => <Text key={`${title}-${index}`} style={styles.claim}>• {value}</Text>)}</View>;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0c0b" },
  boot: { flex: 1, gap: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f1e9" },
  ticker: { height: 32, justifyContent: "center", overflow: "hidden", paddingHorizontal: 12, backgroundColor: "#0b0c0b" },
  tickerText: { color: "#f4f1e9", fontSize: 9, fontWeight: "800", letterSpacing: 1.4 },
  mono: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  connectionPage: { flexGrow: 1, padding: 22, paddingBottom: 50, backgroundColor: "#f4f1e9" },
  brandMark: { fontSize: 28, fontWeight: "900" },
  connectionTitle: { marginTop: 4, fontSize: 34, fontWeight: "900", letterSpacing: -1.5 },
  eyebrow: { alignSelf: "flex-start", marginBottom: 18, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "#0b0c0b", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  hero: { marginBottom: 16, fontSize: 48, lineHeight: 45, fontWeight: "900", letterSpacing: -2 },
  crossed: { textDecorationLine: "line-through", color: "#66665f" },
  highlight: { backgroundColor: "#dce8d6" },
  copy: { marginBottom: 20, maxWidth: 420, fontSize: 13, lineHeight: 19 },
  field: { marginBottom: 14 },
  fieldLabel: { marginBottom: 6, fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  input: { minHeight: 46, borderWidth: 2, borderColor: "#0b0c0b", paddingHorizontal: 12, backgroundColor: "#ebe8df", color: "#0b0c0b", fontSize: 13 },
  textarea: { minHeight: 220, borderWidth: 2, borderColor: "#0b0c0b", padding: 12, backgroundColor: "#ebe8df", color: "#0b0c0b", fontSize: 12, lineHeight: 18 },
  hint: { marginTop: 8, color: "#66665f", fontSize: 10, lineHeight: 15 },
  notice: { marginBottom: 14, borderWidth: 1, borderColor: "#0b0c0b", padding: 10, backgroundColor: "#dce8d6" },
  errorNotice: { backgroundColor: "#f2b39c" },
  noticeText: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  action: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 10, borderWidth: 2, borderColor: "#0b0c0b", backgroundColor: "#0b0c0b", paddingHorizontal: 14 },
  actionSecondary: { backgroundColor: "#f4f1e9" },
  actionText: { color: "#f4f1e9", fontSize: 10, fontWeight: "900", letterSpacing: .8 },
  actionSecondaryText: { color: "#0b0c0b" },
  disabled: { opacity: .5 },
  header: { minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#0b0c0b", paddingLeft: 14, backgroundColor: "#f4f1e9" },
  headerBrand: { fontSize: 24, fontWeight: "900", letterSpacing: -1 },
  headerMeta: { marginTop: 3, fontSize: 7, fontWeight: "800", letterSpacing: 1 },
  refreshButton: { alignSelf: "stretch", justifyContent: "center", borderLeftWidth: 2, borderLeftColor: "#0b0c0b", paddingHorizontal: 16, backgroundColor: "#dce8d6" },
  refreshText: { fontSize: 10, fontWeight: "900" },
  nav: { flexGrow: 0, maxHeight: 62, backgroundColor: "#f4f1e9", borderBottomWidth: 2, borderBottomColor: "#0b0c0b" },
  navContent: { minWidth: "100%" },
  navItem: { minWidth: 92, minHeight: 60, justifyContent: "center", gap: 4, borderRightWidth: 1, borderRightColor: "#0b0c0b", paddingHorizontal: 10 },
  navItemActive: { backgroundColor: "#0b0c0b" },
  navIndex: { fontSize: 8, fontWeight: "700" },
  navLabel: { fontSize: 9, fontWeight: "900" },
  navActiveText: { color: "#f4f1e9" },
  page: { flexGrow: 1, minHeight: "100%", padding: 16, paddingBottom: 80, backgroundColor: "#f4f1e9" },
  loader: { marginBottom: 12 },
  pageTitle: { marginBottom: 20, fontSize: 40, lineHeight: 40, fontWeight: "900", letterSpacing: -1.5 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", marginVertical: 12, borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#0b0c0b" },
  stat: { width: "50%", minHeight: 82, justifyContent: "space-between", borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#0b0c0b", padding: 12 },
  statLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  statValue: { fontSize: 28, fontWeight: "900" },
  sectionTitle: { marginTop: 22, marginBottom: 9, borderBottomWidth: 1, borderBottomColor: "#0b0c0b", paddingBottom: 7, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  conversationRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: "#0b0c0b", paddingVertical: 10 },
  conversationSelected: { backgroundColor: "#dce8d6", paddingHorizontal: 8 },
  rowIndex: { width: 20, fontSize: 9, fontWeight: "800" },
  sourceBadge: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#0b0c0b", backgroundColor: "#ebe8df" },
  sourceText: { fontSize: 9, fontWeight: "900" },
  flex: { flex: 1 },
  rowTitle: { fontSize: 12, fontWeight: "800", lineHeight: 16 },
  meta: { marginTop: 3, color: "#66665f", fontSize: 8, fontWeight: "700", lineHeight: 12, letterSpacing: .25 },
  arrow: { fontSize: 18, fontWeight: "900" },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  divider: { height: 1, marginVertical: 18, backgroundColor: "#0b0c0b" },
  empty: { borderWidth: 1, borderColor: "#0b0c0b", padding: 14, color: "#66665f", fontSize: 11 },
  detailCard: { marginTop: 24, borderWidth: 2, borderColor: "#0b0c0b", padding: 14, backgroundColor: "#ebe8df" },
  detailLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  detailTitle: { marginTop: 8, fontSize: 19, fontWeight: "900", lineHeight: 23 },
  claim: { marginBottom: 6, fontSize: 11, lineHeight: 16 },
  message: { marginBottom: 9, borderWidth: 1, borderColor: "#0b0c0b", padding: 10, backgroundColor: "#f4f1e9" },
  assistantMessage: { backgroundColor: "#dce8d6" },
  messageRole: { marginBottom: 5, fontSize: 8, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  messageText: { fontSize: 11, lineHeight: 17 },
  fieldRow: { flexDirection: "row", gap: 10 },
  fieldHalf: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginVertical: 12, borderWidth: 1, borderColor: "#0b0c0b", padding: 12 },
  switchTitle: { fontSize: 9, fontWeight: "900", letterSpacing: .7 },
  packet: { marginTop: 10, maxHeight: 280, borderWidth: 1, borderColor: "#0b0c0b", padding: 12, backgroundColor: "#ebe8df" },
  packetText: { marginTop: 8, fontSize: 10, lineHeight: 15 },
  successCard: { marginTop: 14, borderWidth: 2, borderColor: "#0b0c0b", padding: 12, backgroundColor: "#dce8d6" },
  link: { marginTop: 7, fontSize: 10, fontWeight: "700", lineHeight: 15 },
  handoffRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: "#0b0c0b", paddingVertical: 10 },
  revokeButton: { borderWidth: 1, borderColor: "#0b0c0b", paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#ef8a63" },
  revokeText: { fontSize: 8, fontWeight: "900" },
  connectorRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "#0b0c0b", paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: "#0b0c0b", backgroundColor: "#b8b5ac" },
  dotOn: { backgroundColor: "#719068" },
  disconnectButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#0b0c0b", backgroundColor: "#ef8a63" },
  disconnectText: { fontSize: 9, fontWeight: "900", letterSpacing: .8 },
});
