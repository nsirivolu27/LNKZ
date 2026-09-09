import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  LockKeyhole,
  MoreHorizontal,
  Sparkles,
  Triangle,
} from "lucide-react";
import "./LnkzClaudeSpace.css";

type Conversation = {
  title: string;
  source: string;
  messages: number;
  updated: string;
};

const conversation: Conversation = {
  title: "Workspace onboarding notes",
  source: "CL",
  messages: 24,
  updated: "Yesterday",
};

export default function LnkzClaudeSpace() {
  const [sent, setSent] = useState(false);
  const [showDestinations, setShowDestinations] = useState(false);
  const [includeRecent, setIncludeRecent] = useState(true);

  return (
    <main className="claude-space-shell">
      <header className="claude-space-header">
        <div className="claude-space-brand">
          <Triangle size={21} strokeWidth={2.8} aria-hidden="true" />
          <div>
            <strong>LNKZ</strong>
            <span>QUICK SEND / PRIVATE BY DEFAULT</span>
          </div>
        </div>
        <button className="claude-space-menu" type="button" aria-label="More options">
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div className="claude-space-progress">
        <span>01 / 03</span>
        <div className="claude-space-progress-line"><i /></div>
        <span>DESTINATION</span>
      </div>

      <section className="claude-space-content" aria-live="polite">
        {sent ? (
          <div className="claude-space-success">
            <div className="claude-space-success-mark"><Check size={29} strokeWidth={2.6} /></div>
            <span className="claude-space-eyebrow">HANDOFF COMPLETE</span>
            <h1>It landed<br /><em>in your space.</em></h1>
            <p>
              <strong>{conversation.title}</strong> is ready in Claude · My space.
              Nothing public. Nothing shared by accident.
            </p>
            <button className="claude-space-secondary" type="button" onClick={() => setSent(false)}>
              <ArrowLeft size={15} /> SEND ANOTHER
            </button>
          </div>
        ) : (
          <>
            <button className="claude-space-back" type="button" onClick={() => setSent(false)}>
              <ArrowLeft size={14} /> BACK TO THREAD
            </button>
            <span className="claude-space-eyebrow">WHERE THIS ONE GOES</span>
            <h1>A small place<br /><em>of your own.</em></h1>
            <p className="claude-space-intro">
              This handoff stays inside your private Claude space. Think of it as a room with the door closed.
            </p>

            <div className="claude-space-room">
              <div className="claude-space-room-top">
                <span className="claude-space-room-label"><LockKeyhole size={12} /> PRIVATE DESTINATION</span>
                <span className="claude-space-room-dot" aria-label="Ready" />
              </div>
              <div className="claude-space-room-name">
                <div className="claude-space-avatar">C</div>
                <div>
                  <strong>Claude · My space</strong>
                  <span>YOUR PRIVATE ROOM</span>
                </div>
                <button
                  className="claude-space-change"
                  type="button"
                  onClick={() => setShowDestinations((value) => !value)}
                  aria-expanded={showDestinations}
                >
                  CHANGE <ChevronDown size={13} />
                </button>
              </div>
              {showDestinations && (
                <div className="claude-space-destinations">
                  <button type="button" onClick={() => setShowDestinations(false)}>
                    <span className="claude-space-mini-avatar">C</span>
                    <span><b>Claude · My space</b><small>READY TO RECEIVE</small></span>
                    <Check size={14} />
                  </button>
                  <div className="claude-space-destination-note">No other destinations connected.</div>
                </div>
              )}
              <div className="claude-space-room-rule" />
              <div className="claude-space-room-note">
                <Sparkles size={14} />
                <span>Only the useful part travels. The rest stays here.</span>
              </div>
            </div>

            <div className="claude-space-packet">
              <div className="claude-space-packet-heading">
                <span>ABOUT TO SEND</span>
                <span>{conversation.messages} MESSAGES</span>
              </div>
              <strong>{conversation.title}</strong>
              <small>{conversation.source} · UPDATED {conversation.updated.toUpperCase()}</small>
            </div>

            <label className="claude-space-toggle">
              <input type="checkbox" checked={includeRecent} onChange={(event) => setIncludeRecent(event.target.checked)} />
              <span className="claude-space-toggle-track"><i /></span>
              <span>Include recent context</span>
              <small>{includeRecent ? "ON" : "OFF"}</small>
            </label>

            <button className="claude-space-send" type="button" onClick={() => setSent(true)}>
              <span>SEND TO MY SPACE</span>
              <ArrowUpRight size={18} />
            </button>
            <div className="claude-space-footnote"><LockKeyhole size={11} /> EXPIRING LINK · PRIVATE BY DEFAULT</div>
          </>
        )}
      </section>
    </main>
  );
}