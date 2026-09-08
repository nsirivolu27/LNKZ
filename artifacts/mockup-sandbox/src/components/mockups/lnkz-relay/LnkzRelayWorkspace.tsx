import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  LockKeyhole,
  Send,
  UploadCloud,
} from "lucide-react";

import "./_group.css";

type Phase = "choose" | "import" | "sending" | "success";

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

function SourceMark({ conversation }: { conversation: Conversation }) {
  return (
    <span className={`lnkz-source-icon ${conversation.sourceClass}`} aria-hidden="true">
      {conversation.source}
    </span>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const chooseActive = phase === "choose" || phase === "import";
  const reviewActive = phase === "sending" || phase === "success";

  return (
    <div className="lnkz-stepper" aria-label="Send progress">
      <span className={`lnkz-step ${chooseActive ? "active" : ""}`}>
        <span className="lnkz-step-number">{chooseActive ? "1" : <Check size={11} />}</span>
        Choose
      </span>
      <span className="lnkz-step-line" />
      <span className={`lnkz-step ${reviewActive ? "active" : ""}`}>
        <span className="lnkz-step-number">2</span>
        Send
      </span>
    </div>
  );
}

function RecentConversations({
  selected,
  recent,
  onSelect,
  onImport,
}: {
  selected: Conversation;
  recent: Conversation[];
  onSelect: (conversation: Conversation) => void;
  onImport: () => void;
}) {
  return (
    <section className="lnkz-panel" aria-labelledby="recent-heading">
      <div className="lnkz-panel-head">
        <div>
          <div className="lnkz-panel-title" id="recent-heading">
            Recent conversations
          </div>
          <div className="lnkz-panel-caption">Pick one to bring into your private space.</div>
        </div>
      </div>
      <div className="lnkz-recent-list">
        {recent.map((conversation) => (
          <button
            className={`lnkz-conversation ${selected.id === conversation.id ? "selected" : ""}`}
            key={conversation.id}
            type="button"
            aria-pressed={selected.id === conversation.id}
            onClick={() => onSelect(conversation)}
          >
            <SourceMark conversation={conversation} />
            <span>
              <span className="lnkz-convo-title">{conversation.title}</span>
              <span className="lnkz-convo-meta">
                {conversation.messages} messages · {conversation.updated}
              </span>
            </span>
            <ChevronRight className="lnkz-conversation-chevron" size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button className="lnkz-import-link" type="button" onClick={onImport}>
        <UploadCloud aria-hidden="true" />
        Import conversation
      </button>
    </section>
  );
}

function SendPreview({
  selected,
  showDetails,
  onSend,
  onToggleDetails,
  sending,
}: {
  selected: Conversation;
  showDetails: boolean;
  onSend: () => void;
  onToggleDetails: () => void;
  sending: boolean;
}) {
  return (
    <section className="lnkz-panel" aria-labelledby="preview-heading">
      <div className="lnkz-selected-preview">
        <div className="lnkz-preview-kicker" id="preview-heading">
          Ready to send
        </div>
        <h2 className="lnkz-preview-title">{selected.title}</h2>
        <p className="lnkz-preview-copy">{selected.summary}</p>
        <div className="lnkz-preview-meta" aria-label="Conversation summary">
          <span>
            <FileText size={10} aria-hidden="true" /> {selected.messages} messages
          </span>
          <span>{selected.decisions} decisions</span>
          <span>{selected.open} open questions</span>
        </div>
      </div>

      <details className="lnkz-disclosure" open={showDetails} onToggle={onToggleDetails}>
        <summary>
          What will be sent
          <ChevronDown className="lnkz-disclosure-chevron" size={14} aria-hidden="true" />
        </summary>
        <div className="lnkz-disclosure-body">
          <p>A concise handoff made from this conversation:</p>
          <ul className="lnkz-detail-list">
            <li><Check size={12} aria-hidden="true" /> Conversation summary</li>
            <li><Check size={12} aria-hidden="true" /> Decisions and open questions</li>
            <li><Check size={12} aria-hidden="true" /> The recent messages needed for context</li>
          </ul>
        </div>
      </details>

      <div className="lnkz-destination">
        <span className="lnkz-destination-mark" aria-hidden="true">C</span>
        <span className="lnkz-destination-copy">
          <span className="lnkz-destination-label">Destination</span>
          <span className="lnkz-destination-name">Claude · My space</span>
        </span>
        <span className="lnkz-ready"><span className="lnkz-ready-dot" /> Ready</span>
      </div>

      <div className="lnkz-panel-body">
        <div className="lnkz-send-row">
          <span className="lnkz-send-note">
            Private to your remote Claude space.<br />
            You can send another conversation anytime.
          </span>
          <button className="lnkz-primary" type="button" disabled={sending} onClick={onSend}>
            <Send size={14} aria-hidden="true" />
            {sending ? "Sending…" : "Send to Claude"}
          </button>
        </div>
      </div>
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
    <div className="lnkz-import-state">
      <button className="lnkz-back" type="button" onClick={onBack}>
        <ArrowLeft size={13} aria-hidden="true" /> Back to recent conversations
      </button>
      <section className="lnkz-panel" aria-labelledby="import-heading">
        <div className="lnkz-panel-head">
          <div>
            <div className="lnkz-panel-title" id="import-heading">Import a conversation</div>
            <div className="lnkz-panel-caption">Paste the useful part. It stays local until you send it.</div>
          </div>
          <UploadCloud size={17} color="var(--teal)" aria-hidden="true" />
        </div>
        <div className="lnkz-panel-body">
          <label className="lnkz-form-label" htmlFor="lnkz-import-text">Conversation text</label>
          <textarea
            className="lnkz-form-textarea"
            id="lnkz-import-text"
            value={text}
            onChange={(event) => onChange(event.target.value)}
            placeholder={"Paste a conversation or a few notes here…"}
          />
          {error && (
            <div className="lnkz-form-error" role="alert">
              <CircleAlert size={13} aria-hidden="true" />
              {error}
            </div>
          )}
          <p className="lnkz-import-hint">
            A title and concise preview will be created from what you paste.
          </p>
          <div className="lnkz-form-actions">
            <button className="lnkz-secondary" type="button" onClick={() => onChange("")}>Clear</button>
            <button className="lnkz-primary" type="button" onClick={onImport}>
              <ArrowUpRight size={14} aria-hidden="true" /> Use this conversation
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SuccessState({ selected, onAnother }: { selected: Conversation; onAnother: () => void }) {
  return (
    <section className="lnkz-panel lnkz-success" aria-live="polite">
      <div className="lnkz-success-mark"><CheckCircle2 aria-hidden="true" /></div>
      <h2>Sent safely.</h2>
      <p>Your conversation is waiting in your private Claude space, ready to pick up where you left off.</p>
      <div className="lnkz-success-card">
        <div className="lnkz-success-card-label">Conversation</div>
        <div className="lnkz-success-card-title">{selected.title}</div>
        <div className="lnkz-success-destination">
          <span>Sent to</span>
          <strong>Claude · My space</strong>
        </div>
      </div>
      <div className="lnkz-success-actions">
        <button className="lnkz-secondary" type="button" onClick={onAnother}>Send another</button>
      </div>
    </section>
  );
}

export function LnkzRelayWorkspace() {
  const [phase, setPhase] = useState<Phase>("choose");
  const [selected, setSelected] = useState<Conversation>(conversations[0]);
  const [importedConversation, setImportedConversation] = useState<Conversation | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
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
    setShowDetails(false);
    setImportedNotice(true);
    setPhase("choose");
  };

  const handleSend = () => {
    setPhase("sending");
    window.setTimeout(() => setPhase("success"), 700);
  };

  const handleAnother = () => {
    setSelected(conversations[0]);
    setShowDetails(false);
    setImportedNotice(false);
    setPhase("choose");
  };

  return (
    <div className="lnkz-shell">
      <div className="lnkz-window">
        <header className="lnkz-topbar">
          <div className="lnkz-brand" aria-label="LNKZ">
            <span className="lnkz-brand-mark" aria-hidden="true"><ArrowUpRight size={15} /></span>
            <span>
              <span className="lnkz-brand-word">LNKZ</span>
              <span className="lnkz-brand-sub">private handoff</span>
            </span>
          </div>
          <div className="lnkz-private-note">
            <LockKeyhole size={13} aria-hidden="true" />
            Stays private
          </div>
        </header>

        <main className="lnkz-content">
          {phase !== "success" && (
            <>
              <div className="lnkz-intro">
                <div className="lnkz-eyebrow"><span className="lnkz-eyebrow-dot" /> Quick handoff</div>
                <h1 className="lnkz-page-title">Send the useful part.</h1>
                <p className="lnkz-page-description">
                  Move one conversation into Claude and keep the context you need.
                </p>
              </div>
              <Stepper phase={phase} />
            </>
          )}

          {phase === "choose" && (
            <>
              {importedNotice && (
                <div className="lnkz-import-success" role="status">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  <span><strong>Conversation imported.</strong> It is ready to review before you send it.</span>
                </div>
              )}
              <RecentConversations
                selected={selected}
                recent={recent}
                onSelect={(conversation) => {
                  setSelected(conversation);
                  setShowDetails(false);
                  setImportedNotice(false);
                }}
                onImport={() => {
                  setImportError("");
                  setImportedNotice(false);
                  setPhase("import");
                }}
              />
              <SendPreview
                selected={selected}
                showDetails={showDetails}
                onToggleDetails={() => setShowDetails((value) => !value)}
                onSend={handleSend}
                sending={false}
              />
            </>
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
            <section className="lnkz-panel lnkz-panel-body lnkz-loading" aria-live="polite">
              <span className="lnkz-loading-bar" aria-hidden="true" />
              Sending {selected.title} to Claude…
            </section>
          )}

          {phase === "success" && (
            <>
              <div className="lnkz-intro">
                <div className="lnkz-eyebrow"><span className="lnkz-eyebrow-dot" /> Handoff complete</div>
              </div>
              <SuccessState selected={selected} onAnother={handleAnother} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}