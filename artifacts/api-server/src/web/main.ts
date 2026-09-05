import { BRAND } from "./branding";
import { icon } from "./icons";
import "./styles.css";

const repository = BRAND.repositoryUrl;
const connectors = ["Slack", "Jira", "Figma", "Docs", "Any MCP server"];

function render(): string {
  return `
<main>
  <section class="hero" id="top">
    <nav class="nav" aria-label="Primary navigation">
      <a class="brand" href="#top" aria-label="${BRAND.productName} home">${icon("link", 19)}<span>${BRAND.productName}</span></a>
      <div class="nav-links">
        <a href="#product">Product</a><a href="#integrations">Integrations</a><a href="#developers">Developers</a><a href="/console.html">Console</a>
      </div>
      <a class="nav-cta" href="${repository}" target="_blank" rel="noreferrer">GitHub ${icon("arrow", 17)}</a>
    </nav>
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">${icon("spark", 15)} Context that moves with you</p>
        <h1>Carry the conversation forward.</h1>
        <p class="hero-text">${BRAND.productName} is a portable context layer for people and AI. Move a useful chat from one model, device, or teammate to the next, then connect it to the tools where the work continues.</p>
        <div class="hero-actions"><a class="button primary" href="/console.html">Open the console ${icon("arrow", 18)}</a><a class="button secondary" href="${repository}" target="_blank" rel="noreferrer">View source</a></div>
        <div class="trust-row"><span>${icon("shield", 16)} Expiring, revocable handoffs</span><span>${icon("database", 16)} Self-hosted data</span><span>${icon("network", 16)} Provider-neutral</span></div>
      </div>
      <div class="relay-card" aria-label="Conversation handoff preview">
        <div class="relay-top"><span><span class="live-dot"></span> Context packet ready</span><small>${BRAND.productName}.conversation.v1</small></div>
        <div class="chat-stack"><div class="message user-message"><span>You</span><p>Compare the launch options and keep the evidence attached.</p></div><div class="message ai-message"><span>${icon("bot", 14)} AI assistant</span><p>Option B is lower risk. Two Jira items remain open, and the Figma flow needs one review.</p></div></div>
        <div class="handoff-line"><span></span>${icon("link", 18)}<span></span></div>
        <div class="handoff-card"><div>${icon("key", 18)}<span><strong>Secure handoff</strong><small>Expires in 60 minutes · 3 uses</small></span></div><span class="packet-id">${BRAND.productName} · 8C4F</span></div>
        <div class="destination-row"><span>${icon("bot", 15)} Different LLM</span><span>${icon("message", 15)} Teammate</span><span>${icon("database", 15)} Other device</span></div>
      </div>
    </div>
  </section>
  <section class="ticker" aria-label="${BRAND.productName} workflow"><span>Any LLM</span>${icon("arrow", 16)}<span>${BRAND.productName} context</span>${icon("arrow", 16)}<span>Any person or device</span>${icon("arrow", 16)}<span>The tools that matter</span></section>
  <section class="section" id="product"><div class="section-heading"><p class="eyebrow">${icon("message", 15)} One context layer</p><h2>Your chats stop being dead ends.</h2><p>A conversation can become a handoff, a research source, a project brief, or the missing context behind a decision. ${BRAND.productName} keeps the thread intact while changing where it can be used.</p></div><div class="capability-grid">${[
    ["Bring the chat in from anywhere", "Import a ChatGPT, Claude, or Gemini export, a Markdown transcript, or a raw paste."],
    ["Send the gist, not the transcript", "A context packet carries decisions, open questions, and next steps inside the next model's token budget."],
    ["Hand it off without handing over your key", "Expiring, use-limited links support redaction, revocation, and an audit trail."],
    ["Search the work around the chat", "One query spans saved conversations and the workspace sources you connect."],
  ].map(([title, text], index) => `<article class="capability-card"><div class="card-top"><span>0${index + 1}</span>${icon("check", 21)}</div><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section>
  <section class="section integration-section" id="integrations"><div class="section-heading"><p class="eyebrow">${icon("network", 15)} Bring the surrounding context</p><h2>Chats connect to the rest of the work.</h2><p>Adapters are optional and failure-isolated. ${BRAND.productName} stays useful as a private conversation relay, then gets richer as each workspace source is connected.</p></div><div class="connector-grid">${connectors.map((label) => `<article class="connector-card"><span class="connector-icon">${icon("database", 21)}</span><div><strong>${label}</strong><small>Optional connector</small></div><span class="status-dot" aria-label="Optional connector"></span></article>`).join("")}</div></section>
  <section class="section developer-section" id="developers"><div class="developer-copy"><p class="eyebrow">${icon("braces", 15)} MCP-native, HTTP-ready</p><h2>One server. Multiple ways in.</h2><p>Run ${BRAND.productName} over Streamable HTTP for hosted clients, stdio for local tools, or the REST surface for ordinary applications. The same conversation store powers every transport.</p><div class="endpoint-list"><span><strong>POST</strong> /mcp</span><span><strong>POST</strong> /api/conversations/import</span><span><strong>POST</strong> /api/context/packet</span></div></div><div class="terminal-card"><div class="terminal-top"><span></span><span></span><span></span><small>${BRAND.productName} tools/list</small></div><pre><code>↳ import_conversation</code><code>↳ build_context_packet</code><code>↳ create_handoff</code><code>↳ search_context</code></pre><div class="terminal-footer">${icon("key", 15)} ${BRAND.apiCompatibilityLabel} · origin validation · hashed handoff tokens</div></div></section>
  <section class="cta-section"><div><p class="eyebrow">${icon("message", 15)} Keep the important part</p><h2>The model can change. The context stays yours.</h2></div><a class="button light" href="${repository}" target="_blank" rel="noreferrer">Open the repository ${icon("arrow", 18)}</a></section>
  <footer class="footer"><a class="brand" href="#top">${icon("link", 19)}<span>${BRAND.productName}</span></a><p>Portable conversation context for people, devices, and AI.</p><span>Open-source MVP · 2026</span></footer>
</main>`;
}

const root = document.getElementById("root");
if (root) root.innerHTML = render();