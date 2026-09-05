import{i as e}from"./styles-BOUOENTT.js";const s="https://github.com/nsirivolu27/LNKZ",o=[{icon:"slack",label:"Slack",detail:"Messages and decisions"},{icon:"ticket",label:"Jira",detail:"Issues and delivery context"},{icon:"figma",label:"Figma",detail:"Design text and components"},{icon:"file",label:"Docs",detail:"Research and references"},{icon:"zap",label:"Any MCP server",detail:"Federated tools, including Fantasy Copilot"}],i=[{icon:"message",title:"Bring the chat in from anywhere",text:"Import a ChatGPT, Claude, or Gemini export, a Markdown transcript, or a raw paste. Everything normalizes to one provider-neutral format."},{icon:"braces",title:"Send the gist, not the transcript",text:"A context packet carries the decisions, the open questions, and the next steps inside whatever token budget the next model has."},{icon:"link",title:"Hand it off without handing over your key",text:"Expiring, use-limited links with hashed tokens, optional secret redaction, revocation, and an audit trail for every redemption."},{icon:"search",title:"Search the work around the chat",text:"One query spans saved conversations plus Slack, Jira, Figma, documentation feeds, and any federated MCP server you connect."}],r=["import_conversation","build_context_packet","create_handoff","continue_handoff","find_conflicts","search_context","audit_log"];function c(){return`
<main>
  <section class="hero" id="top">
    <nav class="nav" aria-label="Primary navigation">
      <a class="brand" href="#top" aria-label="LNKZ home">
        <span class="brand-mark">${e("link",19)}</span><span>LNKZ</span>
      </a>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="#integrations">Integrations</a>
        <a href="#developers">Developers</a>
        <a href="/console.html">Console</a>
      </div>
      <a class="nav-cta" href="${s}" target="_blank" rel="noreferrer">${e("github",17)} GitHub</a>
    </nav>

    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">${e("spark",15)} Context that moves with you</p>
        <h1>Carry the conversation forward.</h1>
        <p class="hero-text">
          LNKZ is a portable context layer for people and AI. Move a useful chat from one model,
          device, or teammate to the next, then connect it to the tools where the work continues.
        </p>
        <div class="hero-actions">
          <a class="button primary" href="/console.html">Open the console ${e("arrow",18)}</a>
          <a class="button secondary" href="${s}" target="_blank" rel="noreferrer">View source</a>
        </div>
        <div class="trust-row">
          <span>${e("shield",16)} Expiring, revocable handoffs</span>
          <span>${e("database",16)} Self-hosted data</span>
          <span>${e("network",16)} Provider-neutral</span>
        </div>
      </div>
      ${l()}
    </div>
  </section>

  <section class="ticker" aria-label="LNKZ workflow">
    <span>Any LLM</span>${e("arrow",16)}<span>LNKZ context</span>${e("arrow",16)}
    <span>Any person or device</span>${e("arrow",16)}<span>The tools that matter</span>
  </section>

  <section class="section" id="product">
    <div class="section-heading">
      <p class="eyebrow">${e("flow",15)} One context layer</p>
      <h2>Your chats stop being dead ends.</h2>
      <p>
        A conversation can become a handoff, a research source, a project brief, or the missing context
        behind a decision. LNKZ keeps the thread intact while changing where it can be used.
      </p>
    </div>
    <div class="capability-grid">
      ${i.map((a,t)=>`
        <article class="capability-card">
          <div class="card-top"><span>0${t+1}</span>${e(a.icon,21)}</div>
          <h3>${a.title}</h3>
          <p>${a.text}</p>
        </article>
      `).join("")}
    </div>
  </section>

  <section class="section integration-section" id="integrations">
    <div class="integration-copy">
      <p class="eyebrow">${e("cloud",15)} Bring the surrounding context</p>
      <h2>Chats connect to the rest of the work.</h2>
      <p>
        Adapters are optional and failure-isolated. LNKZ stays useful as a private conversation relay,
        then gets richer as each workspace source is connected.
      </p>
      <ul class="check-list">
        <li>${e("check",16)} Search only the sources you configured</li>
        <li>${e("check",16)} Preserve source URLs and metadata</li>
        <li>${e("check",16)} Report unavailable connectors instead of inventing context</li>
      </ul>
    </div>
    <div class="connector-grid">
      ${o.map(a=>`
        <article class="connector-card">
          <span class="connector-icon">${e(a.icon,21)}</span>
          <div><strong>${a.label}</strong><small>${a.detail}</small></div>
          <span class="status-dot" aria-label="Optional connector"></span>
        </article>
      `).join("")}
    </div>
  </section>

  <section class="section developer-section" id="developers">
    <div class="developer-copy">
      <p class="eyebrow">${e("braces",15)} MCP-native, HTTP-ready</p>
      <h2>One server. Multiple ways in.</h2>
      <p>
        Run LNKZ over Streamable HTTP for hosted clients, stdio for local tools, or the REST surface for
        ordinary applications. The same conversation store powers every transport.
      </p>
      <div class="endpoint-list">
        <span><strong>POST</strong> /mcp</span>
        <span><strong>POST</strong> /api/conversations/import</span>
        <span><strong>POST</strong> /api/context/packet</span>
        <span><strong>GET</strong> /share/:token</span>
      </div>
    </div>
    <div class="terminal-card">
      <div class="terminal-top"><span></span><span></span><span></span><small>lnkz tools/list</small></div>
      <pre>${r.map(a=>`<code><span>&#8627;</span> ${a}</code>`).join("")}</pre>
      <div class="terminal-footer">${e("key",15)} Bearer auth &middot; origin validation &middot; hashed handoff tokens</div>
    </div>
  </section>

  <section class="cta-section">
    <div>
      <p class="eyebrow">${e("users",15)} Keep the important part</p>
      <h2>The model can change. The context stays yours.</h2>
    </div>
    <a class="button light" href="${s}" target="_blank" rel="noreferrer">Open the repository ${e("arrow",18)}</a>
  </section>

  <footer class="footer">
    <a class="brand" href="#top"><span class="brand-mark">${e("link",19)}</span><span>LNKZ</span></a>
    <p>Portable conversation context for people, devices, and AI.</p>
    <span>Open-source MVP &middot; 2026</span>
  </footer>
</main>`}function l(){return`
<div class="relay-card" aria-label="Conversation handoff preview">
  <div class="relay-top">
    <span><span class="live-dot"></span> Context packet ready</span>
    <small>lnkz.conversation.v1</small>
  </div>
  <div class="chat-stack">
    <div class="message user-message"><span>You</span><p>Compare the launch options and keep the evidence attached.</p></div>
    <div class="message ai-message"><span>${e("bot",14)} AI assistant</span><p>Option B is lower risk. Two Jira items remain open, and the Figma flow needs one review.</p></div>
  </div>
  <div class="handoff-line"><span></span>${e("link",18)}<span></span></div>
  <div class="handoff-card">
    <div>${e("key",18)}<span><strong>Secure handoff</strong><small>Expires in 60 minutes &middot; 3 uses</small></span></div>
    <span class="packet-id">LNKZ &middot; 8C4F</span>
  </div>
  <div class="destination-row">
    <span>${e("bot",15)} Different LLM</span>
    <span>${e("users",15)} Teammate</span>
    <span>${e("cloud",15)} Other device</span>
  </div>
</div>`}const n=document.getElementById("root");n&&(n.innerHTML=c());
