import{i as v}from"./styles-BOUOENTT.js";const w="lnkz.apiKey";function B(){try{return sessionStorage.getItem(w)??""}catch{return""}}function M(e){try{e?sessionStorage.setItem(w,e):sessionStorage.removeItem(w)}catch{}}async function r(e,t={}){const n=new Headers(t.headers);t.body&&n.set("content-type","application/json");const o=B();o&&n.set("authorization",`Bearer ${o}`);const a=await fetch(e,{...t,headers:n});if(a.status===204)return;const i=await a.text(),d=i?A(i):{};if(!a.ok){const y=d.error??(a.status===401?"Unauthorized. Set your API key above.":`Request failed with ${a.status}.`),m=new Error(y);throw m.status=a.status,m}return d}function A(e){try{return JSON.parse(e)}catch{return{error:e.slice(0,400)}}}const c={listConversations:(e={})=>r(`/api/conversations?${new URLSearchParams(e)}`),searchConversations:e=>r("/api/conversations/search",{method:"POST",body:JSON.stringify({query:e,limit:20})}),getConversation:e=>r(`/api/conversations/${e}`),deleteConversation:e=>r(`/api/conversations/${e}`,{method:"DELETE"}),importPayload:e=>r("/api/conversations/import",{method:"POST",body:JSON.stringify(e)}),createHandoff:(e,t)=>r(`/api/conversations/${e}/handoffs`,{method:"POST",body:JSON.stringify(t)}),listHandoffs:()=>r("/api/handoffs"),revokeHandoff:e=>r(`/api/handoffs/${e}`,{method:"DELETE"}),buildPacket:e=>r("/api/context/packet",{method:"POST",body:JSON.stringify(e)}),connectors:()=>r("/api/connectors"),stats:()=>r("/api/stats"),events:()=>r("/api/events?limit=40")},x=[{id:"import",label:"Import",icon:"inbox"},{id:"library",label:"Library",icon:"message"},{id:"packet",label:"Context packet",icon:"braces"},{id:"handoffs",label:"Handoffs",icon:"key"},{id:"status",label:"Status",icon:"network"}],h={tab:"import",selected:null},N=document.getElementById("app");N.innerHTML=j();const f=document.getElementById("panel"),b=document.getElementById("toast"),E=document.getElementById("api-key");E.value=B();E.addEventListener("change",()=>{M(E.value.trim()),l("API key saved for this browser session.")});for(const e of x)document.getElementById(`tab-${e.id}`).addEventListener("click",()=>H(e.id));H("import");function j(){return`
<header class="console-header">
  <a class="brand" href="/"><span class="brand-mark">${v("link",19)}</span><span>LNKZ</span></a>
  <div class="key-field">
    <label for="api-key">API key</label>
    <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="LNKZ_API_KEY (leave blank if unset)" />
  </div>
</header>
<nav class="console-tabs">
  ${x.map(e=>`<button id="tab-${e.id}" class="console-tab" type="button">${v(e.icon,16)} ${e.label}</button>`).join("")}
</nav>
<main id="panel" class="console-panel"></main>
<div id="toast" class="toast" hidden></div>`}function H(e){h.tab=e;for(const t of x)document.getElementById(`tab-${t.id}`).classList.toggle("active",t.id===e);e==="import"&&q(),e==="library"&&C(),e==="packet"&&D(),e==="handoffs"&&S(),e==="status"&&J()}function q(){f.innerHTML=`
<section class="card">
  <h2>Bring a conversation in</h2>
  <p class="hint">
    Paste a ChatGPT, Claude, or Gemini export, a LNKZ packet, a Markdown transcript, or a plain copied chat.
    Run it as a preview first if you are not sure what the file is.
  </p>
  <div class="row">
    <label>Format
      <select id="import-format">
        <option value="auto">Detect automatically</option>
        <option value="chatgpt">ChatGPT export</option>
        <option value="claude">Claude export</option>
        <option value="gemini">Gemini</option>
        <option value="lnkz">LNKZ packet</option>
        <option value="markdown">Markdown transcript</option>
        <option value="text">Plain text</option>
      </select>
    </label>
    <label>Tags (comma separated)
      <input id="import-tags" type="text" placeholder="research, launch" />
    </label>
  </div>
  <textarea id="import-payload" rows="14" spellcheck="false" placeholder="Paste the conversation or export here"></textarea>
  <div class="actions">
    <button id="import-preview" class="button secondary" type="button">Preview</button>
    <button id="import-run" class="button primary" type="button">Import ${v("arrow",16)}</button>
  </div>
  <div id="import-result" class="result" hidden></div>
</section>`;const e=document.getElementById("import-payload"),t=document.getElementById("import-format"),n=document.getElementById("import-tags"),o=document.getElementById("import-result"),a=async i=>{if(!e.value.trim()){l("Paste something to import first.",!0);return}await I(o,async()=>{const d=await c.importPayload({payload:e.value,format:t.value,tags:G(n.value),dryRun:i}),y=d.warnings.map(u=>`<li class="warn">${s(u)}</li>`).join("");if(i){const u=d.preview??[];return`<p>Detected <strong>${s(d.format)}</strong>. Nothing was written.</p>
          <ul>${u.map(k=>`<li>${s(k.title)} — ${k.messages} messages from ${s(k.provider)}</li>`).join("")}${y}</ul>`}const m=d.conversations??[];return`<p>Imported <strong>${m.length}</strong> conversation(s) as ${s(d.format)}.</p>
        <ul>${m.map(u=>`<li>${s(u.title)} <code>${u.id}</code></li>`).join("")}${y}</ul>`})};document.getElementById("import-preview").addEventListener("click",()=>void a(!0)),document.getElementById("import-run").addEventListener("click",()=>void a(!1))}async function C(){f.innerHTML=`
<section class="split">
  <div class="card list-card">
    <div class="row">
      <input id="library-search" type="search" placeholder="Search saved conversations" />
      <button id="library-refresh" class="button secondary" type="button">Refresh</button>
    </div>
    <div id="library-list" class="list">Loading…</div>
  </div>
  <div id="library-detail" class="card detail-card"><p class="hint">Select a conversation to see what it settled and to hand it off.</p></div>
</section>`;const e=document.getElementById("library-search"),t=document.getElementById("library-list"),n=async()=>{t.textContent="Loading…";try{const a=e.value.trim()?(await c.searchConversations(e.value.trim())).matches:(await c.listConversations({limit:"50"})).conversations;t.innerHTML=a.length?a.map(O).join(""):'<p class="hint">Nothing here yet. Import a conversation to get started.</p>';for(const i of t.querySelectorAll("[data-id]"))i.addEventListener("click",()=>void T(i.dataset.id))}catch(a){t.innerHTML=`<p class="error">${s(p(a))}</p>`}};let o;e.addEventListener("input",()=>{window.clearTimeout(o),o=window.setTimeout(()=>void n(),250)}),document.getElementById("library-refresh").addEventListener("click",()=>void n()),await n(),h.selected&&await T(h.selected)}function O(e){return`
<button class="list-row" data-id="${e.id}" type="button">
  <strong>${s(e.title)}</strong>
  <span class="meta">${s(e.source.provider)} · ${e.messageCount} messages · ${g(e.updatedAt)}</span>
  ${e.snippet?`<span class="snippet">${s(e.snippet)}</span>`:""}
</button>`}async function T(e){var n;h.selected=e;const t=document.getElementById("library-detail");if(t){t.innerHTML="Loading…";try{const{conversation:o,analysis:a}=await c.getConversation(e);t.innerHTML=`
<h2>${s(o.title)}</h2>
<p class="meta">${s(o.source.provider)}${o.source.app?` / ${s(o.source.app)}`:""}
 · ${o.messageCount} messages · roughly ${a.approxTokens} tokens</p>
${(n=o.lineage)!=null&&n.parentId?`<p class="meta">Continued from <code>${o.lineage.parentId}</code></p>`:""}
${$("Decisions",a.decisions)}
${$("Open questions",a.openQuestions)}
${$("Action items",a.actionItems)}
${a.topics.length?`<p class="tags">${a.topics.slice(0,10).map(i=>`<span>${s(i)}</span>`).join("")}</p>`:""}

<h3>Create a handoff</h3>
<div class="row">
  <label>Expires in (minutes)<input id="handoff-ttl" type="number" value="60" min="5" max="10080" /></label>
  <label>Max uses<input id="handoff-uses" type="number" value="3" min="1" max="1000" /></label>
</div>
<div class="row">
  <label>Audience<input id="handoff-audience" type="text" placeholder="Who is this for?" /></label>
  <label class="checkbox"><input id="handoff-redact" type="checkbox" checked /> Redact secrets and emails</label>
</div>
<div class="actions">
  <button id="handoff-create" class="button primary" type="button">Create handoff ${v("key",16)}</button>
  <button id="conversation-delete" class="button danger" type="button">Delete</button>
</div>
<div id="handoff-result" class="result" hidden></div>

<h3>Transcript</h3>
<div class="transcript">
  ${o.messages.map(i=>`
    <article class="bubble ${i.role}">
      <span>${s(i.author||i.role)}</span>
      <p>${s(i.content)}</p>
    </article>`).join("")}
</div>`,document.getElementById("handoff-create").addEventListener("click",()=>void R(e)),document.getElementById("conversation-delete").addEventListener("click",()=>void K(e))}catch(o){t.innerHTML=`<p class="error">${s(p(o))}</p>`}}}async function R(e){const t=document.getElementById("handoff-result");await I(t,async()=>{const n=await c.createHandoff(e,{ttlMinutes:L("handoff-ttl",60),maxUses:L("handoff-uses",3),audience:document.getElementById("handoff-audience").value.trim()||void 0,redact:document.getElementById("handoff-redact").checked});return`<p>Share this link. It expires ${g(n.expiresAt)} after up to ${n.maxUses} use(s).</p>
      <div class="copy-row"><code id="share-url">${s(n.shareUrl)}</code>
      <button class="button secondary" type="button" data-copy="${s(n.shareUrl)}">Copy</button></div>
      <p class="hint">Anyone holding this link can read the conversation until it expires. Revoke it from the Handoffs tab.</p>`});for(const n of t.querySelectorAll("[data-copy]"))n.addEventListener("click",()=>void P(n.dataset.copy))}async function K(e){try{await c.deleteConversation(e),h.selected=null,l("Conversation deleted."),await C()}catch(t){l(p(t),!0)}}function D(){f.innerHTML=`
<section class="card">
  <h2>Build a context packet</h2>
  <p class="hint">
    A packet is what you give the next model: decisions, open questions, action items, a recent excerpt,
    and any contradictions between conversations, trimmed to fit a token budget.
  </p>
  <div class="row">
    <label>Query<input id="packet-query" type="text" placeholder="What should the next model know about?" /></label>
    <label>Token budget<input id="packet-budget" type="number" value="4000" min="500" max="60000" step="500" /></label>
  </div>
  <label class="checkbox"><input id="packet-external" type="checkbox" checked /> Include connected sources</label>
  <div class="actions">
    <button id="packet-build" class="button primary" type="button">Build packet ${v("arrow",16)}</button>
  </div>
  <div id="packet-result" class="result" hidden></div>
</section>`,document.getElementById("packet-build").addEventListener("click",()=>{const e=document.getElementById("packet-result");I(e,async()=>{const t=document.getElementById("packet-query").value.trim();if(!t)throw new Error("Enter a query first.");const{packet:n}=await c.buildPacket({query:t,budgetTokens:L("packet-budget",4e3),includeExternal:document.getElementById("packet-external").checked});return`<p class="meta">${n.usedTokens} of ${n.budgetTokens} approx tokens · ${n.conversations.length} conversation(s)</p>
        ${n.conflicts.length?`<p class="warn">${n.conflicts.length} possible contradiction(s) flagged.</p>`:""}
        <div class="copy-row"><button class="button secondary" type="button" data-copy-packet="1">Copy packet</button></div>
        <pre class="packet" id="packet-markdown">${s(n.markdown)}</pre>`}).then(()=>{const t=e.querySelector("[data-copy-packet]");t==null||t.addEventListener("click",()=>void P(document.getElementById("packet-markdown").textContent??""))})})}async function S(){f.innerHTML='<section class="card"><h2>Handoffs</h2><div id="handoff-list">Loading…</div></section>';const e=document.getElementById("handoff-list");try{const{handoffs:t}=await c.listHandoffs();e.innerHTML=t.length?`<table class="table"><thead><tr><th>Status</th><th>Uses</th><th>Expires</th><th>Audience</th><th>Redacted</th><th></th></tr></thead>
         <tbody>${t.map(U).join("")}</tbody></table>`:'<p class="hint">No handoffs issued yet.</p>';for(const n of e.querySelectorAll("[data-revoke]"))n.addEventListener("click",async()=>{try{await c.revokeHandoff(n.dataset.revoke),l("Handoff revoked."),await S()}catch(o){l(p(o),!0)}})}catch(t){e.innerHTML=`<p class="error">${s(p(t))}</p>`}}function U(e){return`
<tr>
  <td><span class="pill ${e.active?"on":"off"}">${e.active?"active":e.revokedAt?"revoked":"spent"}</span></td>
  <td>${e.uses}/${e.maxUses}</td>
  <td>${g(e.expiresAt)}</td>
  <td>${s(e.audience??"—")}</td>
  <td>${e.redact?"yes":"no"}</td>
  <td>${e.active?`<button class="button danger small" type="button" data-revoke="${e.id}">Revoke</button>`:""}</td>
</tr>`}async function J(){f.innerHTML='<section class="card"><h2>Status</h2><div id="status-body">Loading…</div></section>';const e=document.getElementById("status-body");try{const[{connectors:t},{stats:n},{events:o}]=await Promise.all([c.connectors(),c.stats(),c.events()]);e.innerHTML=`
<div class="stat-row">
  <div><strong>${n.conversations}</strong><span>conversations</span></div>
  <div><strong>${n.messages}</strong><span>messages</span></div>
  <div><strong>${n.activeHandoffs}</strong><span>active handoffs</span></div>
  <div><strong>${n.events}</strong><span>audit events</span></div>
</div>
<h3>Providers</h3>
<p class="tags">${n.providers.length?n.providers.map(a=>`<span>${s(a.provider)} · ${a.count}</span>`).join(""):"<span>none yet</span>"}</p>
<h3>Connectors</h3>
<ul class="connector-list">
  ${t.map(a=>`<li><span class="pill ${a.configured?"on":"off"}">${a.configured?"on":"off"}</span>
    <strong>${s(a.label)}</strong><small>${s(a.detail)}</small></li>`).join("")}
</ul>
<h3>Recent events</h3>
<ul class="event-list">
  ${o.map(a=>`<li><code>${s(a.kind)}</code> <span class="meta">${g(a.at)}</span></li>`).join("")||"<li class='hint'>No events yet.</li>"}
</ul>`}catch(t){e.innerHTML=`<p class="error">${s(p(t))}</p>`}}async function I(e,t){e.hidden=!1,e.innerHTML="Working…";try{e.innerHTML=await t()}catch(n){e.innerHTML=`<p class="error">${s(p(n))}</p>`}}function $(e,t){return t.length?`<h3>${e}</h3><ul>${t.slice(0,8).map(n=>`<li>${s(n.text)}</li>`).join("")}</ul>`:""}async function P(e){try{await navigator.clipboard.writeText(e),l("Copied.")}catch{l("Copying was blocked; select the text instead.",!0)}}function l(e,t=!1){b.textContent=e,b.classList.toggle("error",t),b.hidden=!1,window.setTimeout(()=>{b.hidden=!0},3200)}function L(e,t){const n=Number(document.getElementById(e).value);return Number.isFinite(n)?n:t}function G(e){return e.split(",").map(t=>t.trim()).filter(Boolean)}function p(e){return e instanceof Error?e.message:"Something went wrong."}function g(e){const t=new Date(e);return Number.isNaN(t.getTime())?e:t.toLocaleString()}function s(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
