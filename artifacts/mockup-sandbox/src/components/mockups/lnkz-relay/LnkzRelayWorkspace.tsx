import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  Inbox,
  Link2,
  ListChecks,
  Menu,
  MoreHorizontal,
  Network,
  PackageCheck,
  Plus,
  Radio,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import "./_group.css";

type View = "library" | "import" | "packet" | "handoffs" | "status";

type Conversation = {
  id: string;
  source: string;
  sourceClass: string;
  title: string;
  updated: string;
  messages: number;
  decisions: number;
  open: number;
  summary: string;
  decisionsList: string[];
  questions: string[];
  actions: string[];
};

const conversations: Conversation[] = [
  {
    id: "edge-cache",
    source: "GPT",
    sourceClass: "",
    title: "Edge cache invalidation for the relay API",
    updated: "12 min ago",
    messages: 38,
    decisions: 4,
    open: 2,
    summary: "The relay should cache normalized threads at the workspace boundary, then invalidate on import version changes rather than on every packet build.",
    decisionsList: [
      "Normalize once at ingest and retain the source adapter metadata.",
      "Use a 15-minute cache for packet previews; handoffs always read the latest packet.",
      "Keep MCP publishing downstream of handoff creation.",
    ],
    questions: [
      "Do we need per-connector cache controls for regulated workspaces?",
      "Should an expired handoff retain its packet fingerprint for audit views?",
    ],
    actions: [
      "Write cache invalidation contract for connector adapters",
      "Add a packet fingerprint to the handoff payload",
      "Test refresh behavior with a 10k-token thread",
    ],
  },
  {
    id: "onboarding",
    source: "CL",
    sourceClass: "claude",
    title: "Workspace onboarding notes",
    updated: "Yesterday",
    messages: 24,
    decisions: 3,
    open: 1,
    summary: "A short, explicit first-run path is more useful than a guided tour: import a thread, inspect what was extracted, and make one handoff.",
    decisionsList: [
      "Use one workspace-level connector set for the first release.",
      "Show the packet boundary before asking for a destination.",
      "Make expiring handoffs the default.",
    ],
    questions: ["Which parts of onboarding can be resumed from a new device?"],
    actions: ["Draft first-run empty state", "Review connector permission copy"],
  },
  {
    id: "mcp-spec",
    source: "CU",
    sourceClass: "cursor",
    title: "MCP publish preparation",
    updated: "2 days ago",
    messages: 61,
    decisions: 6,
    open: 3,
    summary: "MCP is the next downstream node, not the source of truth. Prepare a resource manifest from the same bounded context packet.",
    decisionsList: [
      "Publish lnkz:// resources with stable lineage metadata.",
      "Keep tool schemas separate from conversation content.",
      "Require an explicit review before the first publish.",
    ],
    questions: [
      "Do downstream clients need a compact transcript resource?",
      "What should a connector report when its publish queue is offline?",
      "Should the workspace expose packet diffs between publishes?",
    ],
    actions: ["Finalize resource naming", "Add connector health event", "Review publish permissions"],
  },
];

const navItems: { id: View; label: string; count?: string; icon: LucideIcon }[] = [
  { id: "library", label: "Conversations", count: "18", icon: Inbox },
  { id: "import", label: "Import thread", icon: UploadCloud },
  { id: "packet", label: "Context packet", icon: PackageCheck },
  { id: "handoffs", label: "Handoffs", count: "3", icon: Send },
  { id: "status", label: "Relay status", icon: Radio },
];

function SourceMark({ conversation }: { conversation: Conversation }) {
  return <span className={`lnkz-source-icon ${conversation.sourceClass}`}>{conversation.source}</span>;
}

function LibraryView({
  selected,
  onSelect,
  onImport,
  showAnalysis,
  setShowAnalysis,
  showLineage,
  setShowLineage,
}: {
  selected: Conversation;
  onSelect: (conversation: Conversation) => void;
  onImport: () => void;
  showAnalysis: boolean;
  setShowAnalysis: (value: boolean) => void;
  showLineage: boolean;
  setShowLineage: (value: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="lnkz-view-stack">
      <div className="lnkz-metrics">
        <div className="lnkz-metric">
          <div className="lnkz-metric-label"><Inbox size={13} /> In the relay library</div>
          <div className="lnkz-metric-value">18</div>
          <div className="lnkz-metric-detail">3 moved this week</div>
        </div>
        <div className="lnkz-metric">
          <div className="lnkz-metric-label"><CheckCircle2 size={13} /> Decisions captured</div>
          <div className="lnkz-metric-value">47</div>
          <div className="lnkz-metric-detail">across 12 threads</div>
        </div>
        <div className="lnkz-metric">
          <div className="lnkz-metric-label"><PackageCheck size={13} /> Context packets</div>
          <div className="lnkz-metric-value">9</div>
          <div className="lnkz-metric-detail">2 waiting review</div>
        </div>
        <div className="lnkz-metric">
          <div className="lnkz-metric-label"><TimerReset size={13} /> Active handoffs</div>
          <div className="lnkz-metric-value">3</div>
          <div className="lnkz-metric-detail">1 closes in 4h</div>
        </div>
      </div>

      <div className="lnkz-grid">
        <section className="lnkz-panel">
          <div className="lnkz-panel-head">
            <div>
              <div className="lnkz-panel-title">Conversation library</div>
              <div className="lnkz-panel-caption">Normalized threads ready to move between nodes</div>
            </div>
            <label className="lnkz-search">
              <Search size={14} />
              <input aria-label="Search conversations" type="search" placeholder="Search threads" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>
          <div className="lnkz-conversation-list">
            {filtered.length ? filtered.map((conversation) => (
              <button className={`lnkz-conversation ${selected.id === conversation.id ? "selected" : ""}`} key={conversation.id} onClick={() => onSelect(conversation)}>
                <SourceMark conversation={conversation} />
                <span>
                  <span className="lnkz-convo-title">{conversation.title}</span>
                  <span className="lnkz-convo-meta">
                    <span className="lnkz-tag"><FileText size={10} /> {conversation.messages} messages</span>
                    <span>{conversation.decisions} decisions</span>
                    <span>{conversation.open} open</span>
                  </span>
                </span>
                <span className="lnkz-convo-time">{conversation.updated}</span>
              </button>
            )) : (
              <div className="lnkz-empty">
                <FolderOpen size={22} />
                <strong>No matching conversations</strong>
                <p>Try a source name or a phrase from the thread title.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="lnkz-panel lnkz-detail">
          <div className="lnkz-detail-top">
            <div className="lnkz-detail-meta"><SourceMark conversation={selected} /> <span>Imported from {selected.source === "GPT" ? "ChatGPT" : selected.source === "CL" ? "Claude" : "Cursor"}</span><span className="lnkz-status-dot" /> normalized</div>
            <h2 className="lnkz-thread-title">{selected.title}</h2>
            <div className="lnkz-detail-meta"><Clock3 size={12} /> Updated {selected.updated} <span>·</span> <span className="lnkz-mono">thread/{selected.id}</span></div>
            <div className="lnkz-detail-actions">
              <button className="lnkz-mini-action" onClick={onImport}><UploadCloud size={13} /> Import another</button>
              <button className="lnkz-mini-action" onClick={() => setShowLineage(!showLineage)}><GitBranch size={13} /> {showLineage ? "Hide lineage" : "View lineage"}</button>
            </div>
          </div>
          <div className="lnkz-detail-body">
            <div className="lnkz-section-head">
              <h3>Model-free analysis</h3>
              <button className="lnkz-text-button" onClick={() => setShowAnalysis(!showAnalysis)}>{showAnalysis ? "Collapse" : "Reveal analysis"}</button>
            </div>
            <div className="lnkz-insight"><strong>Thread signal.</strong> {selected.summary}</div>
            {showAnalysis && (
              <>
                <div className="lnkz-divider" />
                <div className="lnkz-section-head"><h3>Decisions</h3><span className="lnkz-tag">{selected.decisionsList.length} found</span></div>
                <ul className="lnkz-list">{selected.decisionsList.map((item) => <li key={item}><CheckCircle2 size={13} />{item}</li>)}</ul>
                <div className="lnkz-divider" />
                <div className="lnkz-section-head"><h3>Open questions</h3><span className="lnkz-tag">{selected.questions.length} open</span></div>
                <ul className="lnkz-list">{selected.questions.map((item) => <li key={item}><CircleHelp size={13} />{item}</li>)}</ul>
                <div className="lnkz-divider" />
                <div className="lnkz-section-head"><h3>Action items</h3></div>
                <ul className="lnkz-list">{selected.actions.map((item) => <li key={item}><ListChecks size={13} />{item}</li>)}</ul>
              </>
            )}
            {showLineage && (
              <>
                <div className="lnkz-divider" />
                <div className="lnkz-section-head"><h3>Lineage</h3><span className="lnkz-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>3 nodes</span></div>
                <div className="lnkz-lineage"><span className="lnkz-lineage-node">ChatGPT</span><ArrowRight size={12} /><span className="lnkz-lineage-node current">lnkz</span><ArrowRight size={12} /><span className="lnkz-lineage-node">Claude</span></div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ImportView({ onImported, selected }: { onImported: () => void; selected: Conversation }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("ChatGPT export");
  return (
    <div className="lnkz-import-grid">
      <section className="lnkz-panel">
        <div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Bring a conversation into the relay</div><div className="lnkz-panel-caption">Paste an export or drop a structured transcript. LNKZ keeps the source intact.</div></div><MoreHorizontal size={17} color="var(--ink-soft)" /></div>
        <div className="lnkz-panel-body">
          <label className="lnkz-form-label" htmlFor="import-source">Source adapter</label>
          <select className="lnkz-form-input" id="import-source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option>ChatGPT export</option><option>Claude transcript</option><option>Plain text / JSONL</option>
          </select>
          <div style={{ height: 14 }} />
          <label className="lnkz-form-label" htmlFor="import-thread">Conversation content</label>
          <textarea className="lnkz-form-textarea" id="import-thread" value={text} onChange={(event) => setText(event.target.value)} placeholder={`Paste a conversation from ${source.toLowerCase()}...`} />
          <div className="lnkz-form-actions"><button className="lnkz-secondary" onClick={() => setText("")}>Clear</button><button className="lnkz-primary" onClick={onImported}><Zap size={14} /> Normalize conversation</button></div>
        </div>
      </section>
      <div className="lnkz-view-stack">
        <section className="lnkz-panel">
          <div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Drop a file instead</div><div className="lnkz-panel-caption">Supported: .json, .jsonl, .txt</div></div><Archive size={16} color="var(--ink-soft)" /></div>
          <div className="lnkz-panel-body"><div className="lnkz-dropzone"><div><UploadCloud size={26} /><strong>Drop transcript here</strong><p>Files stay local in this prototype. The normalized preview appears in your library.</p><button className="lnkz-secondary" onClick={onImported}>Choose a sample file</button></div></div></div>
        </section>
        <section className="lnkz-panel">
          <div className="lnkz-panel-head"><div><div className="lnkz-panel-title">What gets extracted</div><div className="lnkz-panel-caption">No model required for the relay map</div></div><ShieldCheck size={16} color="var(--teal)" /></div>
          <div className="lnkz-panel-body lnkz-points">
            <div className="lnkz-point"><span className="lnkz-point-icon"><Network size={13} /></span><span><strong>Thread structure</strong><span>Roles, timestamps, source, and stable message ids.</span></span></div>
            <div className="lnkz-point"><span className="lnkz-point-icon"><Sparkles size={13} /></span><span><strong>Relay signal</strong><span>Decisions, open questions, and action items for review.</span></span></div>
            <div className="lnkz-point"><span className="lnkz-point-icon"><Link2 size={13} /></span><span><strong>Lineage anchor</strong><span>A portable id for every downstream handoff.</span></span></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PacketView({ selected, onHandoff }: { selected: Conversation; onHandoff: () => void }) {
  const [query, setQuery] = useState("What should the next engineer know to continue this work?");
  const [budget, setBudget] = useState(2400);
  const [redact, setRedact] = useState(true);
  return (
    <div className="lnkz-packet-layout">
      <section className="lnkz-panel">
        <div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Build a bounded context packet</div><div className="lnkz-panel-caption">Choose the question and the amount of context that can travel.</div></div><PackageCheck size={17} color="var(--teal)" /></div>
        <div className="lnkz-packet-builder">
          <div className="lnkz-query-box">
            <label className="lnkz-form-label" htmlFor="packet-query">Packet query</label>
            <input className="lnkz-form-input" id="packet-query" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="lnkz-range-row">
              <div><label className="lnkz-form-label" htmlFor="packet-budget">Token budget</label><input className="lnkz-range" id="packet-budget" type="range" min="800" max="5000" step="100" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div>
              <div className="lnkz-range-value">{budget.toLocaleString()} tk</div>
            </div>
          </div>
          <div className="lnkz-divider" />
          <div className="lnkz-section-head"><h3>Included from {selected.title}</h3><span className="lnkz-tag"><Check size={10} /> bounded</span></div>
          <ul className="lnkz-list">
            <li><CheckCircle2 size={13} /> All {selected.decisions} decisions, ranked above open questions</li>
            <li><CheckCircle2 size={13} /> {selected.open} open questions that still need an owner</li>
            <li><CheckCircle2 size={13} /> Recent messages around the active workstream</li>
          </ul>
          <label className="lnkz-check-row"><input type="checkbox" checked={redact} onChange={(event) => setRedact(event.target.checked)} /> Redact source-specific metadata before the packet leaves this workspace.</label>
          <div className="lnkz-form-actions"><button className="lnkz-secondary"><Settings2 size={13} /> Preview rules</button><button className="lnkz-primary" onClick={onHandoff}><Send size={14} /> Create handoff</button></div>
        </div>
      </section>
      <aside className="lnkz-packet-preview">
        <div className="lnkz-packet-kicker">PACKET PREVIEW / v0.8</div>
        <div className="lnkz-packet-title">Next node context</div>
        <div className="lnkz-packet-stat"><span>Source thread</span><strong>{selected.source} · {selected.id}</strong></div>
        <div className="lnkz-packet-stat"><span>Estimated size</span><strong>{Math.round(budget * .82).toLocaleString()} tokens</strong></div>
        <div className="lnkz-packet-stat"><span>Redaction</span><strong>{redact ? "workspace metadata" : "none"}</strong></div>
        <div className="lnkz-packet-list"><div><CheckCircle2 size={13} /> thread summary</div><div><CheckCircle2 size={13} /> decisions + rationale</div><div><CheckCircle2 size={13} /> open questions</div><div><CheckCircle2 size={13} /> lineage fingerprint</div></div>
      </aside>
    </div>
  );
}

function HandoffsView({ onNew }: { onNew: () => void }) {
  return (
    <div className="lnkz-view-stack">
      <section className="lnkz-panel">
        <div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Handoff ledger</div><div className="lnkz-panel-caption">Portable links with a bounded payload, an expiry, and a clear lineage.</div></div><button className="lnkz-primary" onClick={onNew}><Plus size={14} /> New handoff</button></div>
        <div className="lnkz-panel-body lnkz-handoff-list">
          <div className="lnkz-handoff"><span className="lnkz-handoff-icon"><Send size={15} /></span><span><span className="lnkz-handoff-title">Edge cache invalidation → Claude</span><span className="lnkz-handoff-meta"><span className="lnkz-mono">lnkz://handoff/7fa2</span><span>1,968 tokens</span><span>2 uses left</span></span></span><span className="lnkz-handoff-state"><CheckCircle2 size={13} /> Open · 4h</span></div>
          <div className="lnkz-handoff"><span className="lnkz-handoff-icon"><Code2 size={15} /></span><span><span className="lnkz-handoff-title">MCP publish preparation → local MCP</span><span className="lnkz-handoff-meta"><span className="lnkz-mono">lnkz://handoff/2c19</span><span>2,404 tokens</span><span>5 uses left</span></span></span><span className="lnkz-handoff-state"><CheckCircle2 size={13} /> Open · 2d</span></div>
          <div className="lnkz-handoff closed"><span className="lnkz-handoff-icon"><Archive size={15} /></span><span><span className="lnkz-handoff-title">Workspace onboarding notes → teammate</span><span className="lnkz-handoff-meta"><span className="lnkz-mono">lnkz://handoff/a991</span><span>1,104 tokens</span><span>0 uses left</span></span></span><span className="lnkz-handoff-state"><AlertTriangle size={13} /> Closed · expired</span></div>
        </div>
      </section>
      <div className="lnkz-grid">
        <section className="lnkz-panel"><div className="lnkz-panel-head"><div><div className="lnkz-panel-title">No hidden payloads</div><div className="lnkz-panel-caption">Every handoff is inspectable before it travels.</div></div><ShieldCheck size={16} color="var(--teal)" /></div><div className="lnkz-panel-body lnkz-points"><div className="lnkz-point"><span className="lnkz-point-icon"><TimerReset size={13} /></span><span><strong>Expiring by default</strong><span>Links close on time or after the configured use limit.</span></span></div><div className="lnkz-point"><span className="lnkz-point-icon"><GitBranch size={13} /></span><span><strong>Lineage stays attached</strong><span>Continue elsewhere without losing where the work came from.</span></span></div></div></section>
        <section className="lnkz-empty-state"><Database size={25} /><strong style={{ display: "block", fontSize: 12, marginBottom: 5 }}>One destination is still empty</strong><p style={{ color: "var(--ink-soft)", fontSize: 10, lineHeight: 1.5, margin: 0 }}>Connect a downstream MCP destination from Relay status when you are ready to publish this workspace.</p></section>
      </div>
    </div>
  );
}

function StatusView() {
  return (
    <div className="lnkz-status-grid">
      <section className="lnkz-panel"><div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Workspace relay status</div><div className="lnkz-panel-caption">The path from source conversation to downstream MCP resource.</div></div><button className="lnkz-quiet-button" aria-label="Refresh status"><Settings2 size={16} /></button></div><div className="lnkz-panel-body lnkz-status-list">
        <div className="lnkz-status-row"><span className="lnkz-status-symbol"><CheckCircle2 size={14} /></span><span><span className="lnkz-status-name">Conversation library</span><span className="lnkz-status-note">18 normalized threads · last scan 12 min ago</span></span><span className="lnkz-status-pill">Healthy</span></div>
        <div className="lnkz-status-row"><span className="lnkz-status-symbol"><PackageCheck size={14} /></span><span><span className="lnkz-status-name">Packet builder</span><span className="lnkz-status-note">Bounded previews respond in 184ms average</span></span><span className="lnkz-status-pill">Ready</span></div>
        <div className="lnkz-status-row"><span className="lnkz-status-symbol"><Send size={14} /></span><span><span className="lnkz-status-name">Handoff ledger</span><span className="lnkz-status-note">3 open resources · one closes in 4 hours</span></span><span className="lnkz-status-pill">Healthy</span></div>
        <div className="lnkz-status-row"><span className="lnkz-status-symbol warn"><Network size={14} /></span><span><span className="lnkz-status-name">MCP destination</span><span className="lnkz-status-note">Publish preparation is waiting for connector review</span></span><span className="lnkz-status-pill warn">Review</span></div>
      </div></section>
      <div className="lnkz-view-stack">
        <section className="lnkz-panel"><div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Connector check</div><div className="lnkz-panel-caption">Last checked just now</div></div><Link2 size={16} color="var(--teal)" /></div><div className="lnkz-panel-body"><div className="lnkz-skeleton"><div className="lnkz-skeleton-line" /><div className="lnkz-skeleton-line short" /><div className="lnkz-skeleton-line" /><div className="lnkz-skeleton-line short" /></div><div className="lnkz-divider" /><div className="lnkz-status-note">Refreshing connector capabilities and publish permissions…</div></div></section>
        <section className="lnkz-panel"><div className="lnkz-panel-head"><div><div className="lnkz-panel-title">Resource namespace</div><div className="lnkz-panel-caption">Stable addresses for downstream clients</div></div><Clipboard size={16} color="var(--teal)" /></div><div className="lnkz-panel-body"><div className="lnkz-insight"><span className="lnkz-mono">lnkz://workspace/field-notes</span><br /><span style={{ fontSize: 10, color: "var(--ink-soft)" }}>MCP publish will expose reviewed packets, never the full library.</span></div></div></section>
      </div>
    </div>
  );
}

export function LnkzRelayWorkspace() {
  const [view, setView] = useState<View>("library");
  const [selected, setSelected] = useState(conversations[0]);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showLineage, setShowLineage] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [imported, setImported] = useState(false);

  const selectView = (nextView: View) => {
    setView(nextView);
    setMobileOpen(false);
  };
  const handleImported = () => {
    setImported(true);
    setView("library");
  };
  const handleCopy = () => {
    setShared(true);
    void navigator.clipboard?.writeText("lnkz://handoff/7fa2");
  };

  const current = navItems.find((item) => item.id === view) ?? navItems[0];

  return (
    <div className="lnkz-shell">
      <div className="lnkz-layout">
        <aside className={`lnkz-sidebar ${mobileOpen ? "open" : ""}`}>
          <div className="lnkz-brand"><span className="lnkz-brand-mark">↗</span><span><span className="lnkz-brand-word">LNKZ</span><span className="lnkz-brand-sub">relay workspace</span></span></div>
          <div className="lnkz-section-label">Workspace</div>
          <nav className="lnkz-nav" aria-label="Workspace views">
            {navItems.map(({ id, label, count, icon: Icon }) => <button className={view === id ? "active" : ""} key={id} onClick={() => selectView(id)}><Icon /><span className="lnkz-nav-copy">{label}</span>{count && <span className="lnkz-nav-count">{count}</span>}</button>)}
          </nav>
          <div className="lnkz-sidebar-spacer" />
          <div className="lnkz-workspace-switcher"><div className="lnkz-workspace-kicker">Current workspace</div><div className="lnkz-workspace-row"><span className="lnkz-workspace-avatar">FN</span><span><span className="lnkz-workspace-name">Field Notes</span><span className="lnkz-workspace-meta">Personal · 3 connectors</span></span><ChevronRight size={14} color="#789891" style={{ marginLeft: "auto" }} /></div></div>
        </aside>
        <main className="lnkz-main">
          <header className="lnkz-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button className="lnkz-mobile-toggle" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={16} /></button><div className="lnkz-breadcrumb"><span>Field Notes</span><ChevronRight size={13} /><strong>{current.label}</strong></div></div>
            <div className="lnkz-top-actions"><button className="lnkz-quiet-button" aria-label="Help"><CircleHelp size={16} /></button><button className="lnkz-quiet-button" aria-label="Settings"><Settings2 size={16} /></button><span className="lnkz-avatar">AR</span></div>
          </header>
          <div className="lnkz-content">
            <div className="lnkz-page-head">
              <div><div className="lnkz-eyebrow"><span className="lnkz-eyebrow-dot" /> thread in motion</div><h1 className="lnkz-page-title">{view === "library" ? "Keep the useful part moving." : current.label}</h1><p className="lnkz-page-description">{view === "library" ? "A calm control room for conversations that need to travel. Inspect the thread, bound its context, then hand it to the next node with its lineage intact." : view === "import" ? "Bring a conversation in from another system and make its structure portable." : view === "packet" ? "Shape only the context the next node needs. A bounded packet is easier to trust, review, and move." : view === "handoffs" ? "Every handoff has a destination, a boundary, and a closing moment." : "See which parts of the relay path are ready, waiting, or asking for review."}</p></div>
              {view === "library" && <button className="lnkz-primary" onClick={() => selectView("import")}><Plus size={15} /> Import conversation</button>}
              {view === "packet" && <button className="lnkz-primary" onClick={() => setHandoffOpen(true)}><Send size={14} /> Create handoff</button>}
            </div>
            {imported && view === "library" && <div className="lnkz-share-success" style={{ marginBottom: 16 }}><CheckCircle2 size={15} /><span><strong>Conversation normalized.</strong> Your new thread is ready to inspect before it travels.</span><button className="lnkz-text-button" style={{ marginLeft: "auto" }} onClick={() => setImported(false)}>Dismiss</button></div>}
            {view === "library" && <LibraryView selected={selected} onSelect={setSelected} onImport={() => selectView("import")} showAnalysis={showAnalysis} setShowAnalysis={setShowAnalysis} showLineage={showLineage} setShowLineage={setShowLineage} />}
            {view === "import" && <ImportView onImported={handleImported} selected={selected} />}
            {view === "packet" && <PacketView selected={selected} onHandoff={() => setHandoffOpen(true)} />}
            {view === "handoffs" && <HandoffsView onNew={() => { setView("packet"); setMobileOpen(false); }} />}
            {view === "status" && <StatusView />}
          </div>
        </main>
      </div>
      {handoffOpen && <div className="lnkz-overlay" role="dialog" aria-modal="true" aria-label="Create handoff"><div className="lnkz-modal">
        <div className="lnkz-modal-head"><div><div className="lnkz-modal-title">Open a handoff</div><div className="lnkz-modal-copy">Create a bounded, expiring resource from <strong>{selected.title}</strong>.</div></div><button className="lnkz-modal-close" aria-label="Close handoff dialog" onClick={() => { setHandoffOpen(false); setShared(false); }}><X size={17} /></button></div>
        <div className="lnkz-modal-body">
          {shared ? <div className="lnkz-share-success"><CheckCircle2 size={16} /><span><strong>Handoff ready to travel.</strong><br />Anyone with the link can use this packet twice before it closes in 4 hours.</span></div> : <><div className="lnkz-modal-row"><div><label className="lnkz-form-label" htmlFor="destination">Next node</label><select className="lnkz-form-input" id="destination"><option>Claude</option><option>Teammate link</option><option>Local MCP</option></select></div><div><label className="lnkz-form-label" htmlFor="expiry">Closes after</label><select className="lnkz-form-input" id="expiry"><option>4 hours</option><option>24 hours</option><option>7 days</option></select></div></div><div style={{ height: 16 }} /><label className="lnkz-form-label" htmlFor="uses">Use limit</label><select className="lnkz-form-input" id="uses"><option>2 uses</option><option>5 uses</option><option>Unlimited until expiry</option></select><label className="lnkz-check-row"><input type="checkbox" defaultChecked /> Redact workspace-specific metadata and source names.</label><div className="lnkz-form-actions"><button className="lnkz-secondary" onClick={() => setHandoffOpen(false)}>Cancel</button><button className="lnkz-primary" onClick={handleCopy}><Copy size={14} /> Create & copy link</button></div></>}
          {shared && <div className="lnkz-form-actions"><button className="lnkz-secondary" onClick={() => { setHandoffOpen(false); setShared(false); }}>Done</button><button className="lnkz-primary" onClick={handleCopy}><Copy size={14} /> Copy again</button></div>}
        </div>
      </div></div>}
    </div>
  );
}

export default LnkzRelayWorkspace;