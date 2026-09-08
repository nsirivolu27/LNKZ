import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  FileText,
  LockKeyhole,
  Send,
  Star,
  Triangle,
  UploadCloud,
} from "lucide-react";

import "./_group.css";

type Phase = "choose" | "import" | "sending" | "success";
type View = 0 | 1 | 2 | 3;

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
    summary:
      "Normalize threads at the workspace boundary, then invalidate on import version changes rather than on every packet build.",
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
    summary:
      "A short first-run path is more useful than a guided tour: import a thread, inspect what was extracted, then make one handoff.",
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
    summary:
      "MCP is downstream, not the source of truth. Prepare a bounded context from the same conversation before publishing.",
  },
];

const sections = [
  { index: "01", label: "THE THREAD" },
  { index: "02", label: "THE PACKET" },
  { index: "03", label: "THE DESTINATION" },
  { index: "04", label: "THE HANDOFF" },
] as const;

function SourceMark({ conversation }: { conversation: Conversation }) {
  return (
    <span className={`lnkz-source-icon ${conversation.sourceClass}`} aria-hidden="true">
      {conversation.source}
    </span>
  );
}

function Ticker() {
  return (
    <div className="lnkz-ticker" aria-label="LNKZ product note">
      <span>★ KEEP THE CONTEXT — LOSE THE NOISE — PRIVATE HANDOFF — LNKZ —</span>
    </div>
  );
}

function Header({ onSend, disabled }: { onSend: () => void; disabled: boolean }) {
  return (
    <header className="lnkz-header">
      <div className="lnkz-header-brand">
        <Triangle className="lnkz-brand-triangle" size={24} strokeWidth={2.7} aria-hidden="true" />
        <div>
          <h1>LNKZ</h1>
          <p>CONTEXT RELAY · EST. NOW · PRIVATE BY DEFAULT</p>
        </div>
      </div>
      <button className="lnkz-get-button" type="button" onClick={onSend} disabled={disabled}>
        SEND <ArrowUpRight size={17} strokeWidth={2.7} aria-hidden="true" />
      </button>
    </header>
  );
}

function SectionRail({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <nav className="lnkz-section-rail" aria-label="Handoff stages">
      {sections.map((section, index) => (
        <button
          key={section.index}
          className={`lnkz-section-tab ${view === index ? "active" : ""}`}
          type="button"
          aria-current={view === index ? "step" : undefined}
          onClick={() => onView(index as View)}
        >
          <span>{section.index}</span>
          <strong>{section.label}</strong>
        </button>
      ))}
    </nav>
  );
}

function ThreadView({
  selected,
  recent,
  onSelect,
  onImport,
  importedNotice,
}: {
  selected: Conversation;
  recent: Conversation[];
  onSelect: (conversation: Conversation) => void;
  onImport: () => void;
  importedNotice: boolean;
}) {
  return (
    <section className="lnkz-stage lnkz-thread-stage" aria-labelledby="thread-heading">
      <div className="lnkz-stage-note">RELAY / NOTICE OF CHANGE / EFFECTIVE IMMEDIATELY</div>
      <h2 id="thread-heading" className="lnkz-stage-title">
        <span className="lnkz-crossed">NOISE.</span>
        <br />
        <span className="lnkz-mono">IS NOW</span>
        <br />
        <span className="lnkz-highlight">USEFUL.</span>
      </h2>
      <p className="lnkz-stage-copy">
        Pick one conversation. LNKZ keeps the decisions, the open questions, and the useful part of the route.
      </p>

      {importedNotice && (
        <div className="lnkz-import-success" role="status">
          <Check size={13} aria-hidden="true" />
          <span><strong>Imported.</strong> Ready to review.</span>
        </div>
      )}

      <div className="lnkz-thread-list" aria-label="Recent conversations">
        {recent.map((conversation) => (
          <button
            className={`lnkz-thread-row ${selected.id === conversation.id ? "selected" : ""}`}
            key={conversation.id}
            type="button"
            aria-pressed={selected.id === conversation.id}
            onClick={() => onSelect(conversation)}
          >
            <span className="lnkz-thread-index">{selected.id === conversation.id ? ">" : "·"}</span>
            <SourceMark conversation={conversation} />
            <span className="lnkz-thread-copy">
              <strong>{conversation.title}</strong>
              <small>{conversation.messages} messages · {conversation.updated}</small>
            </span>
          </button>
        ))}
      </div>
      <button className="lnkz-import-link" type="button" onClick={onImport}>
        <UploadCloud size={14} aria-hidden="true" />
        IMPORT A CONVERSATION
      </button>
    </section>
  );
}

function PacketView({ selected }: { selected: Conversation }) {
  return (
    <section className="lnkz-stage" aria-labelledby="packet-heading">
      <div className="lnkz-stage-note">PACKET / WHAT WILL TRAVEL / BOUNDED CONTEXT</div>
      <h2 id="packet-heading" className="lnkz-stage-title lnkz-stage-title-small">
        THE USEFUL
        <br />
        PART.
      </h2>
      <div className="lnkz-packet-name">
        <span>SELECTED THREAD</span>
        <strong>{selected.title}</strong>
      </div>
      <div className="lnkz-packet-grid">
        <div><span>01</span><strong>{selected.messages}</strong><small>MESSAGES</small></div>
        <div><span>02</span><strong>{selected.decisions}</strong><small>DECISIONS</small></div>
        <div><span>03</span><strong>{selected.open}</strong><small>OPEN QUESTIONS</small></div>
      </div>
      <div className="lnkz-packet-copy">
        <FileText size={16} aria-hidden="true" />
        <p>{selected.summary}</p>
      </div>
      <div className="lnkz-packet-checks">
        <div><Check size={13} aria-hidden="true" /> Summary and decisions</div>
        <div><Check size={13} aria-hidden="true" /> Recent messages needed for context</div>
        <div><Check size={13} aria-hidden="true" /> No unrelated workspace detail</div>
      </div>
    </section>
  );
}

function DestinationView() {
  return (
    <section className="lnkz-stage" aria-labelledby="destination-heading">
      <div className="lnkz-stage-note">DESTINATION / PRIVATE REMOTE SPACE / CLAUDE</div>
      <h2 id="destination-heading" className="lnkz-stage-title lnkz-stage-title-small">
        WHERE THE
        <br />
        <span className="lnkz-highlight">ROUTE ENDS.</span>
      </h2>
      <div className="lnkz-destination-card">
        <div className="lnkz-destination-mark">C</div>
        <div>
          <span>PRIVATE DESTINATION</span>
          <strong>Claude · My space</strong>
        </div>
        <span className="lnkz-ready"><span /> READY</span>
      </div>
      <p className="lnkz-stage-copy">
        The current handoff opens as a private, expiring link for Claude. Direct account delivery can be added when a managed destination is available.
      </p>
      <div className="lnkz-safe-note">
        <LockKeyhole size={14} aria-hidden="true" />
        <span><strong>PRIVATE BY DEFAULT.</strong> Nothing is sent until you confirm the handoff.</span>
      </div>
    </section>
  );
}

function HandoffView({
  selected,
  success,
  onSend,
  onAnother,
  sending,
}: {
  selected: Conversation;
  success: boolean;
  onSend: () => void;
  onAnother: () => void;
  sending: boolean;
}) {
  return (
    <section className={`lnkz-stage lnkz-handoff-stage ${success ? "complete" : ""}`} aria-labelledby="handoff-heading" aria-live="polite">
      <div className="lnkz-stage-note">{success ? "HANDOFF / COMPLETE / READY TO CONTINUE" : "HANDOFF / FINAL CHECK / ONE SEND"}</div>
      <h2 id="handoff-heading" className="lnkz-stage-title lnkz-stage-title-small">
        {success ? "SENT." : "MAKE THE"}
        <br />
        <span className="lnkz-highlight">{success ? "ROUTE." : "HANDOFF."}</span>
      </h2>
      <div className="lnkz-handoff-card">
        <span>CONVERSATION</span>
        <strong>{selected.title}</strong>
        <div className="lnkz-handoff-divider" />
        <span>{success ? "STATUS" : "DESTINATION"}</span>
        <strong>{success ? "PRIVATE LINK CREATED" : "CLAUDE · MY SPACE"}</strong>
      </div>
      {success ? (
        <>
          <div className="lnkz-link-box">
            <span>EXPIRING HANDOFF LINK</span>
            <code>lnkz://handoff/useful-part-7h4k</code>
          </div>
          <button className="lnkz-secondary" type="button" onClick={onAnother}>SEND ANOTHER</button>
        </>
      ) : (
        <>
          <p className="lnkz-stage-copy">One private handoff. The link expires after use and keeps this context separate from the rest of your workspace.</p>
          <button className="lnkz-send-button" type="button" onClick={onSend} disabled={sending}>
            {sending ? "CREATING HANDOFF…" : "CREATE HANDOFF"} <Send size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}

function ImportState({
  text,
  error,
  onChange,
  onBack,
  onImport,
}: {
  text: string;
  error: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  return (
    <section className="lnkz-stage lnkz-import-stage" aria-labelledby="import-heading">
      <button className="lnkz-back" type="button" onClick={onBack}>
        <ArrowLeft size={13} aria-hidden="true" /> BACK TO THE THREAD
      </button>
      <div className="lnkz-stage-note">IMPORT / PASTE THE USEFUL PART / LOCAL UNTIL SENT</div>
      <h2 id="import-heading" className="lnkz-stage-title lnkz-stage-title-small">BRING IT<br /><span className="lnkz-highlight">WITH YOU.</span></h2>
      <label className="lnkz-form-label" htmlFor="lnkz-import-text">Conversation text</label>
      <textarea
        className="lnkz-form-textarea"
        id="lnkz-import-text"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Paste a conversation or a few notes here…"
      />
      {error && (
        <div className="lnkz-form-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {error}
        </div>
      )}
      <p className="lnkz-import-hint">A title and concise preview will be created from what you paste.</p>
      <div className="lnkz-form-actions">
        <button className="lnkz-secondary" type="button" onClick={() => onChange("")}>CLEAR</button>
        <button className="lnkz-send-button" type="button" onClick={onImport}>USE THIS CONVERSATION <ArrowUpRight size={14} aria-hidden="true" /></button>
      </div>
    </section>
  );
}

export function LnkzRelayWorkspace() {
  const [phase, setPhase] = useState<Phase>("choose");
  const [view, setView] = useState<View>(0);
  const [selected, setSelected] = useState<Conversation>(conversations[0]);
  const [importedConversation, setImportedConversation] = useState<Conversation | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importedNotice, setImportedNotice] = useState(false);

  const recent = importedConversation ? [importedConversation, ...conversations] : conversations;

  const handleImport = () => {
    const cleaned = importText.trim();
    if (!cleaned) {
      setImportError("Paste a little conversation text first.");
      return;
    }
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const title = (lines[0] || "Imported conversation").replace(/^(user|assistant|me|claude):\s*/i, "");
    const summarySource = lines.slice(1).join(" ") || lines[0];
    const imported: Conversation = {
      id: "local-import",
      source: "TXT",
      sourceClass: "imported",
      title: title.length > 62 ? `${title.slice(0, 59)}…` : title,
      updated: "Just now",
      messages: Math.max(2, lines.length),
      decisions: 1,
      open: 1,
      summary: summarySource.length > 172 ? `${summarySource.slice(0, 169)}…` : summarySource,
    };
    setImportedConversation(imported);
    setSelected(imported);
    setImportError("");
    setImportedNotice(true);
    setPhase("choose");
    setView(0);
  };

  const handleSend = () => {
    setPhase("sending");
    window.setTimeout(() => {
      setPhase("success");
      setView(3);
    }, 700);
  };

  const handleAnother = () => {
    setSelected(conversations[0]);
    setImportedNotice(false);
    setPhase("choose");
    setView(0);
  };

  const handleView = (nextView: View) => {
    if (phase === "sending" || phase === "success") return;
    setView(nextView);
  };

  return (
    <div className="lnkz-shell">
      <div className="lnkz-window">
        <Ticker />
        <Header onSend={handleSend} disabled={phase === "sending" || phase === "success"} />
        {phase !== "import" && <SectionRail view={view} onView={handleView} />}

        <main className="lnkz-main">
          {phase === "choose" && view === 0 && (
            <ThreadView
              selected={selected}
              recent={recent}
              onSelect={(conversation) => {
                setSelected(conversation);
                setImportedNotice(false);
              }}
              onImport={() => {
                setImportError("");
                setImportedNotice(false);
                setPhase("import");
              }}
              importedNotice={importedNotice}
            />
          )}
          {phase === "choose" && view === 1 && <PacketView selected={selected} />}
          {phase === "choose" && view === 2 && <DestinationView />}
          {phase === "choose" && view === 3 && (
            <HandoffView selected={selected} success={false} onSend={handleSend} onAnother={handleAnother} sending={false} />
          )}
          {phase === "import" && (
            <ImportState
              text={importText}
              error={importError}
              onChange={(value) => {
                setImportText(value);
                if (importError) setImportError("");
              }}
              onBack={() => setPhase("choose")}
              onImport={handleImport}
            />
          )}
          {phase === "sending" && (
            <HandoffView selected={selected} success={false} onSend={handleSend} onAnother={handleAnother} sending />
          )}
          {phase === "success" && (
            <HandoffView selected={selected} success onSend={handleSend} onAnother={handleAnother} sending={false} />
          )}
        </main>

        <footer className="lnkz-footer">
          <div><span>RATING</span><strong>4.9 <Star size={12} fill="currentColor" aria-hidden="true" /></strong></div>
          <div><span>HANDOFFS</span><strong>23.4K</strong></div>
          <div><span>VERSION</span><strong>0.2</strong></div>
          <div><span>TTL</span><strong>7 DAYS</strong></div>
          <div className="lnkz-footer-note">
            <LockKeyhole size={12} aria-hidden="true" />
            <span>RELEASE NOTES: USEFUL CONTEXT. PRIVATE LINKS. NOTHING ELSE CHANGED — ON PRINCIPLE.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}