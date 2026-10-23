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
  Switch,
  Text as NativeText,
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
  type ImportPreview,
  type IssuedHandoff,
  type Lineage,
  type Packet,
  type Stats,
} from "./src/api";
import { useTheme } from "./src/styles";
import { clearConnection, loadConnection, saveConnection, type StoredConnection } from "./src/storage";

type Tab = "home" | "library" | "import" | "handoffs" | "settings";

const TABS: { id: Tab; label: string; mark: string }[] = [
  { id: "home", label: "HOME", mark: "01" },
  { id: "library", label: "LIBRARY", mark: "02" },
  { id: "import", label: "IMPORT", mark: "03" },
  { id: "handoffs", label: "HANDOFFS", mark: "04" },
  { id: "settings", label: "SETTINGS", mark: "05" },
];

const DEFAULT_URL = process.env.EXPO_PUBLIC_LNKZ_API_URL
  ?? (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "http://localhost:3100");

export default function App() {
  const { styles, colors, dark } = useTheme();
  const [booting, setBooting] = useState(true);
  const [connection, setConnection] = useState<StoredConnection | null>(null);

  useEffect(() => {
    loadConnection()
      .then(setConnection)
      .catch(() => setConnection(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={styles.boot}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ActivityIndicator color={colors.accent} />
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
  const { styles, dark } = useTheme();
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
      // /ready first, then an authenticated call. Separating them is what lets
      // the error say whether the URL is wrong or the key is, instead of one
      // "could not connect" covering both.
      await new LnkzClient(candidate.baseUrl, candidate.apiKey).checkConnection();
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
      <StatusBar style={dark ? "light" : "dark"} />
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
  const { styles, colors, dark } = useTheme();
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
      <StatusBar style={dark ? "light" : "dark"} />
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
        {loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
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
  const { styles } = useTheme();
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
  const { styles, colors } = useTheme();
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
      {busy === "conversation" ? <ActivityIndicator color={colors.accent} /> : null}
      {selected ? <ConversationDetail client={client} value={selected} onChanged={() => onOpen(selected.conversation.id)} /> : null}
    </View>
  );
}

function ConversationDetail({ client, value, onChanged }: {
  client: LnkzClient;
  value: { conversation: Conversation; analysis: Analysis };
  onChanged: () => Promise<void>;
}) {
  const { styles, colors } = useTheme();
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const save = async () => {
    const content = followUp.trim();
    if (!content) { setProblem("Write something first."); return; }
    setSaving(true);
    setProblem("");
    try {
      await client.appendMessage(value.conversation.id, { role: "user", content });
      // Only cleared once the server has it. Losing what someone typed because
      // a request failed is the fastest way to make an app untrustworthy.
      setFollowUp("");
      await onChanged();
    } catch (cause) {
      setProblem(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailLabel}>SELECTED THREAD</Text>
      <Text style={styles.detailTitle}>{value.conversation.title}</Text>
      <Text style={styles.meta}>{value.conversation.source.provider} · {value.analysis.approxTokens} APPROX TOKENS</Text>
      <Provenance lineage={value.conversation.lineage} />
      <ClaimList title="DECISIONS" values={value.analysis.decisions.map((item) => item.text)} />
      <ClaimList title="OPEN QUESTIONS" values={value.analysis.openQuestions.map((item) => item.text)} />
      <ClaimList title="ACTIONS" values={value.analysis.actionItems.map((item) => item.text)} />
      <SectionTitle>TRANSCRIPT</SectionTitle>
      {value.conversation.messages.map((message) => (
        <View key={message.id} style={[styles.message, message.role === "assistant" && styles.assistantMessage]}>
          <Text style={styles.messageRole}>{message.author || message.role}</Text>
          <Text style={styles.messageText}>{message.content}</Text>
        </View>
      ))}
      <SectionTitle>ADD A FOLLOW-UP</SectionTitle>
      <TextInput multiline textAlignVertical="top" style={styles.textarea} value={followUp} onChangeText={setFollowUp} placeholder="What happened next…" placeholderTextColor={colors.subtle} />
      {problem ? <Text style={styles.hint}>{problem}</Text> : null}
      <Action label={saving ? "SAVING…" : "SAVE FOLLOW-UP →"} onPress={save} disabled={saving} secondary />
    </View>
  );
}

/**
 * Where this conversation came from, when it did not start here.
 *
 * A locally authored conversation shows nothing: an empty provenance block on
 * every thread would train people to ignore the one that matters. An imported
 * one names the instance rather than only the id, because an id on its own is
 * not an address and tells a person nothing.
 */
function Provenance({ lineage }: { lineage?: Lineage }) {
  const { styles } = useTheme();
  if (!lineage?.originInstance && !lineage?.continuedBy && !lineage?.parentId) return null;
  return (
    <View style={styles.provenance}>
      <Text style={styles.detailLabel}>WHERE THIS CAME FROM</Text>
      {lineage.originInstance ? (
        <Text style={styles.meta}>Handed over by {lineage.originInstance}</Text>
      ) : null}
      {lineage.continuedBy ? (
        <Text style={styles.meta}>Continued in {lineage.continuedBy}</Text>
      ) : null}
      {lineage.importedAt ? (
        <Text style={styles.meta}>Arrived {new Date(lineage.importedAt).toLocaleString()}</Text>
      ) : null}
      {lineage.rootId ? (
        <Text style={styles.hint}>Chain root {lineage.rootId}</Text>
      ) : null}
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
  const { styles, colors } = useTheme();
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
      <TextInput multiline textAlignVertical="top" style={styles.textarea} value={payload} onChangeText={setPayload} placeholder="Paste ChatGPT, Claude, Gemini, Markdown, JSON, or plain text…" placeholderTextColor={colors.subtle} />
      <Text style={styles.hint}>LNKZ detects the format and preserves the original message order.</Text>
      <Action label={busy === "import" ? "IMPORTING…" : "IMPORT CONVERSATION →"} onPress={run} disabled={busy === "import"} />
      <View style={styles.divider} />
      <ReceiveLink client={client} onReceived={onImported} setError={setError} />
    </View>
  );
}

/**
 * Taking a handoff someone sent you.
 *
 * Two different things can happen with a link, and conflating them is how the
 * chain gets lost. Importing keeps a copy and records where it came from.
 * Continuing does that and adds your turn as a new conversation that says which
 * client carried the work forward. Editing an imported copy afterwards looks
 * the same on screen and leaves nothing saying the work moved on.
 *
 * Preview first, always. A share link is a bearer link: whoever holds it can
 * redeem it, and every redemption spends one of its uses. Showing what is
 * inside before committing means nobody burns a one-use link finding out.
 */
function ReceiveLink({ client, onReceived, setError }: {
  client: LnkzClient;
  onReceived: (conversation: ConversationSummary) => Promise<void>;
  setError: (value: string) => void;
}) {
  const { styles, colors } = useTheme();
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [role, setRole] = useState<"user" | "assistant">("user");
  const [reply, setReply] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [working, setWorking] = useState("");

  const look = async () => {
    if (!url.trim()) { setError("Paste the handoff link first."); return; }
    setWorking("preview");
    setError("");
    try {
      setPreview(await client.previewLink(url.trim()));
    } catch (cause) {
      setPreview(null);
      setError(messageOf(cause));
    } finally {
      setWorking("");
    }
  };

  const take = async (mode: "copy" | "continue") => {
    if (!preview || working) return;
    if (!url.trim()) { setError("Paste the handoff link first."); return; }
    if (mode === "continue" && !reply.trim()) { setError("Write the turn you are adding."); return; }
    if (mode === "continue" && !provider.trim()) { setError("Name the client you are continuing in."); return; }
    setWorking(mode);
    setError("");
    try {
      const result = mode === "copy"
        ? await client.importLink(url.trim())
        : await client.continueFromLink({ url: url.trim(), provider: provider.trim(), content: reply.trim(), role });
      setUrl("");
      setReply("");
      setPreview(null);
      await onReceived(result.conversation);
    } catch (cause) {
      // Deliberately leaves the link and the reply in place. A failed redemption
      // is often a link that expired or a relay that was asleep, and retyping
      // a paragraph to retry is the wrong tax for that.
      setError(messageOf(cause));
    } finally {
      setWorking("");
    }
  };

  return (
    <View>
      <Text style={styles.eyebrow}>RECEIVE / A LINK SOMEONE SENT YOU</Text>
      <Field label="HANDOFF LINK" value={url} onChangeText={(value) => { setUrl(value); setPreview(null); }} editable={!working} autoCapitalize="none" placeholder="https://their-relay.example.com/share/…" />
      <Action label={working === "preview" ? "LOOKING…" : "PREVIEW LINK"} onPress={() => void look()} secondary disabled={Boolean(working)} />
      {preview ? (
        <View style={styles.provenance}>
          <Text style={styles.detailLabel}>{preview.preview.title}</Text>
          <Text style={styles.meta}>{preview.preview.provider} · {preview.preview.messages} MESSAGES</Text>
          <Text style={styles.meta}>From {preview.origin.instance}</Text>
          <Text style={styles.meta}>
            {preview.preview.usesRemaining} {preview.preview.usesRemaining === 1 ? "USE" : "USES"} LEFT · EXPIRES {new Date(preview.preview.expiresAt).toLocaleString()}
            {preview.preview.redact ? " · REDACTED" : ""}
          </Text>
          <Text style={styles.hint}>Looking is free. Importing or continuing spends one use.</Text>
          {preview.warnings.map((warning) => <Text key={warning} style={styles.hint}>{warning}</Text>)}
        </View>
      ) : null}
      <Field label="CONTINUE IN" value={provider} onChangeText={setProvider} autoCapitalize="none" placeholder="claude, gemini, chatgpt…" />
      <Text style={styles.fieldLabel}>YOUR TURN (FOR CONTINUING)</Text>
      <View style={styles.buttonRow}>
        <Action label={role === "user" ? "✓ MY MESSAGE" : "MY MESSAGE"} onPress={() => setRole("user")} secondary />
        <Action label={role === "assistant" ? "✓ MODEL RESPONSE" : "MODEL RESPONSE"} onPress={() => setRole("assistant")} secondary />
      </View>
      <TextInput multiline textAlignVertical="top" style={styles.textarea} value={reply} onChangeText={setReply} placeholder="What you are adding on top of their work…" placeholderTextColor={colors.subtle} />
      <Action label={working === "continue" ? "CONTINUING…" : "CONTINUE IT HERE →"} onPress={() => void take("continue")} disabled={Boolean(working) || !preview} />
      <Action label={working === "copy" ? "IMPORTING…" : "JUST KEEP A COPY"} onPress={() => void take("copy")} secondary disabled={Boolean(working) || !preview} />
      <Text style={styles.hint}>Preview first, then choose one action. Receiving spends one use. LNKZ saves the turn you enter; it does not call the named model.</Text>
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
  const { styles, colors } = useTheme();
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
    try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      setNotice("Handoff link copied.");
      return;
    }
      if (Platform.OS === "web") {
        setNotice("Select and copy the link shown below, then paste it into Import on the other device.");
      } else await Share.share({ message: value });
    } catch {
      setNotice("Select and copy the link shown below, then paste it into Import on the other device.");
    }
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
          <View style={styles.switchRow}><View style={styles.switchCopy}><Text style={styles.switchTitle}>REDACT SENSITIVE TEXT</Text><Text style={styles.hint}>Remove emails, secrets, and bearer tokens.</Text></View><Switch value={redact} onValueChange={setRedact} trackColor={{ false: colors.strong, true: colors.accent }} /></View>
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
  const { styles } = useTheme();
  const [testing, setTesting] = useState(false);
  const retest = async () => {
    setTesting(true); setError("");
    try { await client.checkConnection(); setNotice("Connection verified."); }
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
  const { styles } = useTheme();
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
  const { styles, colors } = useTheme();
  const { label, style, ...inputProps } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.subtle} style={[styles.input, style]} {...inputProps} /></View>;
}

function Action({ label, onPress, secondary, disabled }: { label: string; onPress: () => void | Promise<void>; secondary?: boolean; disabled?: boolean }) {
  const { styles } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} style={[styles.action, secondary && styles.actionSecondary, disabled && styles.disabled]} onPress={() => void onPress()} disabled={disabled}><Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>{label}</Text></Pressable>;
}

function Notice({ children, tone }: { children: ReactNode; tone?: "error" }) {
  const { styles } = useTheme();
  return <View style={[styles.notice, tone === "error" && styles.errorNotice]}><Text style={styles.noticeText}>{children}</Text></View>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  const { styles } = useTheme(); return <Text style={styles.sectionTitle}>{children}</Text>; }
function Empty({ children }: { children: ReactNode }) {
  const { styles } = useTheme(); return <Text style={styles.empty}>{children}</Text>; }
function Stat({ label, value }: { label: string; value: number }) {
  const { styles } = useTheme(); return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function ClaimList({ title, values }: { title: string; values: string[] }) {
  const { styles } = useTheme();
  if (!values.length) return null;
  return <View><SectionTitle>{title}</SectionTitle>{values.slice(0, 5).map((value, index) => <Text key={`${title}-${index}`} style={styles.claim}>• {value}</Text>)}</View>;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}


function Text({ style, ...props }: ComponentProps<typeof NativeText>) {
  const { colors } = useTheme();
  return <NativeText {...props} style={[{ color: colors.text }, style]} />;
}
