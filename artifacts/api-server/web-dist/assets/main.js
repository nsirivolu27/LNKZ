import{a,b as e}from"./chunks/chunk-4YV635CM.js";var o=a.repositoryUrl,i=["Slack","Jira","Figma","Docs","Any MCP server"];function c(){return`
<main>
  <section class="hero" id="top">
    <nav class="nav" aria-label="Primary navigation">
      <a class="brand" href="#top" aria-label="${a.productName} home">${e("link",19)}<span>${a.productName}</span></a>
      <div class="nav-links">
        <a href="#product">Product</a><a href="#integrations">Integrations</a><a href="#developers">Developers</a><a href="/console.html">Console</a>
      </div>
      <a class="nav-cta" href="${o}" target="_blank" rel="noreferrer">GitHub ${e("arrow",17)}</a>
    </nav>
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">${e("spark",15)} Context that moves with you</p>
        <h1>Carry the conversation forward.</h1>
        <p class="hero-text">${a.productName} is a portable context layer for people and AI. Move a useful chat from one model, device, or teammate to the next, then connect it to the tools where the work continues.</p>
        <div class="hero-actions"><a class="button primary" href="/console.html">Open the console ${e("arrow",18)}</a><a class="button secondary" href="${o}" target="_blank" rel="noreferrer">View source</a></div>
        <div class="trust-row"><span>${e("shield",16)} Expiring, revocable handoffs</span><span>${e("database",16)} Self-hosted data</span><span>${e("network",16)} Provider-neutral</span></div>
      </div>
      <div class="relay-card" aria-label="Conversation handoff preview">
        <div class="relay-top"><span><span class="live-dot"></span> Context packet ready</span><small>${a.productName}.conversation.v1</small></div>
        <div class="chat-stack"><div class="message user-message"><span>You</span><p>Compare the launch options and keep the evidence attached.</p></div><div class="message ai-message"><span>${e("bot",14)} AI assistant</span><p>Option B is lower risk. Two Jira items remain open, and the Figma flow needs one review.</p></div></div>
        <div class="handoff-line"><span></span>${e("link",18)}<span></span></div>
        <div class="handoff-card"><div>${e("key",18)}<span><strong>Secure handoff</strong><small>Expires in 60 minutes \xB7 3 uses</small></span></div><span class="packet-id">${a.productName} \xB7 8C4F</span></div>
        <div class="destination-row"><span>${e("bot",15)} Different LLM</span><span>${e("message",15)} Teammate</span><span>${e("database",15)} Other device</span></div>
      </div>
    </div>
  </section>
  <section class="ticker" aria-label="${a.productName} workflow"><span>Any LLM</span>${e("arrow",16)}<span>${a.productName} context</span>${e("arrow",16)}<span>Any person or device</span>${e("arrow",16)}<span>The tools that matter</span></section>
  <section class="section" id="product"><div class="section-heading"><p class="eyebrow">${e("message",15)} One context layer</p><h2>Your chats stop being dead ends.</h2><p>A conversation can become a handoff, a research source, a project brief, or the missing context behind a decision. ${a.productName} keeps the thread intact while changing where it can be used.</p></div><div class="capability-grid">${[["Bring the chat in from anywhere","Import a ChatGPT, Claude, or Gemini export, a Markdown transcript, or a raw paste."],["Send the gist, not the transcript","A context packet carries decisions, open questions, and next steps inside the next model's token budget."],["Hand it off without handing over your key","Expiring, use-limited links support redaction, revocation, and an audit trail."],["Search the work around the chat","One query spans saved conversations and the workspace sources you connect."]].map(([s,t],r)=>`<article class="capability-card"><div class="card-top"><span>0${r+1}</span>${e("check",21)}</div><h3>${s}</h3><p>${t}</p></article>`).join("")}</div></section>
  <section class="section integration-section" id="integrations"><div class="section-heading"><p class="eyebrow">${e("network",15)} Bring the surrounding context</p><h2>Chats connect to the rest of the work.</h2><p>Adapters are optional and failure-isolated. ${a.productName} stays useful as a private conversation relay, then gets richer as each workspace source is connected.</p></div><div class="connector-grid">${i.map(s=>`<article class="connector-card"><span class="connector-icon">${e("database",21)}</span><div><strong>${s}</strong><small>Optional connector</small></div><span class="status-dot" aria-label="Optional connector"></span></article>`).join("")}</div></section>
  <section class="section developer-section" id="developers"><div class="developer-copy"><p class="eyebrow">${e("braces",15)} MCP-native, HTTP-ready</p><h2>One server. Multiple ways in.</h2><p>Run ${a.productName} over Streamable HTTP for hosted clients, stdio for local tools, or the REST surface for ordinary applications. The same conversation store powers every transport.</p><div class="endpoint-list"><span><strong>POST</strong> /mcp</span><span><strong>POST</strong> /api/conversations/import</span><span><strong>POST</strong> /api/context/packet</span></div></div><div class="terminal-card"><div class="terminal-top"><span></span><span></span><span></span><small>${a.productName} tools/list</small></div><pre><code>\u21B3 import_conversation</code><code>\u21B3 build_context_packet</code><code>\u21B3 create_handoff</code><code>\u21B3 search_context</code></pre><div class="terminal-footer">${e("key",15)} ${a.apiCompatibilityLabel} \xB7 origin validation \xB7 hashed handoff tokens</div></div></section>
  <section class="cta-section"><div><p class="eyebrow">${e("message",15)} Keep the important part</p><h2>The model can change. The context stays yours.</h2></div><a class="button light" href="${o}" target="_blank" rel="noreferrer">Open the repository ${e("arrow",18)}</a></section>
  <footer class="footer"><a class="brand" href="#top">${e("link",19)}<span>${a.productName}</span></a><p>Portable conversation context for people, devices, and AI.</p><span>Open-source MVP \xB7 2026</span></footer>
</main>`}var n=document.getElementById("root");n&&(n.innerHTML=c());
