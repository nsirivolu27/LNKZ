import { BRAND } from "./branding";
import { client, getApiKey, setApiKey, type ConversationSummary, type HandoffSummary } from "./api";
import { icon } from "./icons";
import "./styles.css";
import "./console.css";

type TabId = "import" | "library" | "packet" | "handoffs" | "status";
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "import", label: "Import", icon: "inbox" },
  { id: "library", label: "Library", icon: "message" },
  { id: "packet", label: "Context packet", icon: "braces" },
  { id: "handoffs", label: "Handoffs", icon: "key" },
  { id: "status", label: "Status", icon: "network" },
];
const state: { tab: TabId; selected: string | null } = { tab: "import", selected: null };
const app = document.getElementById("app")!;

app.innerHTML = `<header class="console-header"><a class="brand" href="/">${icon("link", 19)}<span>${BRAND.productName}</span></a><div class="auth-actions"><a class="button secondary" href="/api/login?returnTo=${encodeURIComponent("/console.html")}">Sign in</a><form class="key-field" id="api-key-form"><label for="api-key">${BRAND.apiKeyLabel}</label><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${BRAND.apiKeyPlaceholder}" /><small>${BRAND.apiCompatibilityLabel}</small></form></div></header><nav class="console-tabs">${tabs.map((tab) => `<button id="tab-${tab.id}" class="console-tab" type="button">${icon(tab.icon, 16)} ${tab.label}</button>`).join("")}</nav><main id="panel" class="console-panel"></main><div id="toast" class="toast" hidden></div>`;
const panel = document.getElementById("panel")!;
const toast = document.getElementById("toast")!;
const keyInput = document.getElementById("api-key") as HTMLInputElement;
keyInput.value = getApiKey();
document.getElementById("api-key-form")!.addEventListener("submit", (event) => { event.preventDefault(); setApiKey(keyInput.value.trim()); notify(`${BRAND.apiKeyLabel} saved for this browser session.`); });
for (const tab of tabs) document.getElementById(`tab-${tab.id}`)!.addEventListener("click", () => selectTab(tab.id));
selectTab("import");

function selectTab(tab: TabId): void {
  state.tab = tab;
  for (const candidate of tabs) document.getElementById(`tab-${candidate.id}`)!.classList.toggle("active", candidate.id === tab);
  if (tab === "import") renderImport();
  if (tab === "library") void renderLibrary();
  if (tab === "packet") renderPacket();
  if (tab === "handoffs") void renderHandoffs();
  if (tab === "status") void renderStatus();
}

function renderImport(): void {
  panel.innerHTML = `<section class="card"><h2>Bring a conversation in</h2><p class="hint">Paste a ChatGPT, Claude, or Gemini export, a ${BRAND.productName} packet, a Markdown transcript, or a plain copied chat. Preview it first if you are not sure what the file is.</p><div class="row"><label>Format<select id="import-format"><option value="auto">Detect automatically</option><option value="chatgpt">ChatGPT export</option><option value="claude">Claude export</option><option value="gemini">Gemini</option><option value="markdown">Markdown</option><option value="plain">Plain text</option></select></label><label>Title (optional)<input id="import-title" type="text" placeholder="A useful name for this conversation" /></label></div><label>Conversation data<textarea id="import-data" rows="13" placeholder="Paste JSON, Markdown, or copied messages here"></textarea></label><div class="actions"><button id="import-preview" class="button secondary" type="button">Preview</button><button id="import-submit" class="button primary" type="button">Import ${icon("arrow", 16)}</button></div><div id="import-result" class="result" hidden></div></section>`;
  document.getElementById("import-preview")!.addEventListener("click", () => void importConversation(true));
  document.getElementById("import-submit")!.addEventListener("click", () => void importConversation(false));
}

async function importConversation(preview: boolean): Promise<void> {
  const result = document.getElementById("import-result")!;
  const data = (document.getElementById("import-data") as HTMLTextAreaElement).value.trim();
  if (!data) { result.hidden = false; result.innerHTML = `<p class="error">Paste conversation data first.</p>`; return; }
  result.hidden = false; result.textContent = "Working…";
  try {
    const payload = await client.importPayload({ format: (document.getElementById("import-format") as HTMLSelectElement).value, title: (document.getElementById("import-title") as HTMLInputElement).value.trim() || undefined, data, preview });
    result.innerHTML = `<p><strong>${preview ? "Preview ready" : "Import complete"}</strong> · detected as ${escape(payload.format)}.</p>${payload.warnings.length ? `<p class="warn">${payload.warnings.map(escape).join("<br>")}</p>` : ""}${payload.conversations?.length ? `<p>${payload.conversations.length} conversation(s) added.</p>` : ""}${payload.preview ? `<pre class="packet">${escape(JSON.stringify(payload.preview, null, 2))}</pre>` : ""}`;
  } catch (error) { result.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

async function renderLibrary(): Promise<void> {
  panel.innerHTML = `<section class="split"><div class="card list-card"><div class="card-heading"><div><h2>Conversation library</h2><p class="hint">Search what your team has carried forward.</p></div><button id="library-refresh" class="button secondary small" type="button">Refresh</button></div><input id="library-search" type="search" placeholder="Search conversations" /><div id="library-list" class="list">Loading…</div></div><div id="library-detail" class="card detail-card"><p class="hint">Select a conversation to inspect its context.</p></div></section>`;
  const list = document.getElementById("library-list")!;
  const search = document.getElementById("library-search") as HTMLInputElement;
  const load = async (): Promise<void> => {
    try {
      const value = search.value.trim();
      const items = value ? (await client.searchConversations(value)).matches : (await client.listConversations({ limit: "50" })).conversations;
      list.innerHTML = items.length ? items.map(conversationRow).join("") : `<p class="hint">Nothing here yet. Import a conversation to get started.</p>`;
      for (const node of list.querySelectorAll<HTMLElement>("[data-id]")) node.addEventListener("click", () => void showConversation(node.dataset.id!));
    } catch (error) { list.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
  };
  let timer: number | undefined;
  search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 250); });
  document.getElementById("library-refresh")!.addEventListener("click", () => void load());
  await load();
}

function conversationRow(item: ConversationSummary): string {
  return `<button class="list-row" data-id="${escape(item.id)}" type="button"><strong>${escape(item.title)}</strong><span class="meta">${escape(item.source.provider)} · ${item.messageCount} messages · ${date(item.updatedAt)}</span>${item.summary ? `<span class="snippet">${escape(item.summary)}</span>` : ""}</button>`;
}

async function showConversation(id: string): Promise<void> {
  state.selected = id;
  const detail = document.getElementById("library-detail");
  if (!detail) return;
  detail.textContent = "Loading…";
  try {
    const { conversation, analysis } = await client.getConversation(id);
    detail.innerHTML = `<h2>${escape(conversation.title)}</h2><p class="meta">${escape(conversation.source.provider)} · ${conversation.messageCount} messages · roughly ${analysis.approxTokens} tokens</p>${claimList("Decisions", analysis.decisions)}${claimList("Open questions", analysis.openQuestions)}${claimList("Action items", analysis.actionItems)}<h3>Create a handoff</h3><div class="row"><label>Expires in (minutes)<input id="handoff-ttl" type="number" value="60" min="5" max="10080" /></label><label>Max uses<input id="handoff-uses" type="number" value="3" min="1" max="1000" /></label></div><div class="row"><label>Audience<input id="handoff-audience" type="text" placeholder="Who is this for?" /></label><label class="checkbox"><input id="handoff-redact" type="checkbox" checked /> Redact secrets and emails</label></div><div class="actions"><button id="handoff-create" class="button primary" type="button">Create handoff ${icon("key", 16)}</button><button id="conversation-delete" class="button danger" type="button">Delete</button></div><div id="handoff-result" class="result" hidden></div><h3>Transcript</h3><div class="transcript">${conversation.messages.map((message) => `<article class="bubble ${escape(message.role)}"><span>${escape(message.author || message.role)}</span><p>${escape(message.content)}</p></article>`).join("")}</div>`;
    document.getElementById("handoff-create")!.addEventListener("click", () => void createHandoff(id));
    document.getElementById("conversation-delete")!.addEventListener("click", () => void deleteConversation(id));
  } catch (error) { detail.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

async function createHandoff(id: string): Promise<void> {
  const result = document.getElementById("handoff-result")!;
  result.hidden = false;
  try {
    const handoff = await client.createHandoff(id, { ttlMinutes: numberValue("handoff-ttl", 60), maxUses: numberValue("handoff-uses", 3), audience: (document.getElementById("handoff-audience") as HTMLInputElement).value.trim() || undefined, redact: (document.getElementById("handoff-redact") as HTMLInputElement).checked });
    result.innerHTML = `<p>Share this link. It expires ${date(handoff.expiresAt)} after up to ${handoff.maxUses} use(s).</p><div class="copy-row"><code>${escape(handoff.shareUrl)}</code><button class="button secondary" type="button" id="copy-handoff">Copy</button></div>`;
    document.getElementById("copy-handoff")!.addEventListener("click", () => void copy(handoff.shareUrl));
  } catch (error) { result.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

async function deleteConversation(id: string): Promise<void> {
  try { await client.deleteConversation(id); state.selected = null; notify("Conversation deleted."); await renderLibrary(); } catch (error) { notify(messageOf(error), true); }
}

function renderPacket(): void {
  panel.innerHTML = `<section class="card"><h2>Build a context packet</h2><p class="hint">Give the next model the decisions, open questions, action items, and relevant excerpts inside a predictable token budget.</p><div class="row"><label>Query<input id="packet-query" type="text" placeholder="What should the next model know about?" /></label><label>Token budget<input id="packet-budget" type="number" value="4000" min="500" max="60000" step="500" /></label></div><label class="checkbox"><input id="packet-external" type="checkbox" checked /> Include connected sources</label><div class="actions"><button id="packet-build" class="button primary" type="button">Build packet ${icon("arrow", 16)}</button></div><div id="packet-result" class="result" hidden></div></section>`;
  document.getElementById("packet-build")!.addEventListener("click", () => void buildPacket());
}

async function buildPacket(): Promise<void> {
  const result = document.getElementById("packet-result")!;
  result.hidden = false;
  try {
    const query = (document.getElementById("packet-query") as HTMLInputElement).value.trim();
    if (!query) throw new Error("Enter a query first.");
    const { packet } = await client.buildPacket({ query, budgetTokens: numberValue("packet-budget", 4000), includeExternal: (document.getElementById("packet-external") as HTMLInputElement).checked });
    result.innerHTML = `<p class="meta">${packet.usedTokens} of ${packet.budgetTokens} approx tokens · ${packet.conversations.length} conversation(s)</p>${packet.conflicts.length ? `<p class="warn">${packet.conflicts.length} possible contradiction(s) flagged.</p>` : ""}<div class="copy-row"><button class="button secondary" type="button" id="copy-packet">Copy packet</button></div><pre class="packet" id="packet-markdown">${escape(packet.markdown)}</pre>`;
    document.getElementById("copy-packet")!.addEventListener("click", () => void copy(packet.markdown));
  } catch (error) { result.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

async function renderHandoffs(): Promise<void> {
  panel.innerHTML = `<section class="card"><h2>Handoffs</h2><p class="hint">Review and revoke expiring links shared from the library.</p><div id="handoff-list">Loading…</div></section>`;
  try {
    const { handoffs } = await client.listHandoffs();
    document.getElementById("handoff-list")!.innerHTML = handoffs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Status</th><th>Uses</th><th>Expires</th><th>Audience</th><th></th></tr></thead><tbody>${handoffs.map(handoffRow).join("")}</tbody></table></div>` : `<p class="hint">No handoffs have been created.</p>`;
    for (const button of document.querySelectorAll<HTMLElement>("[data-revoke]")) button.addEventListener("click", () => void revoke(button.dataset.revoke!));
  } catch (error) { document.getElementById("handoff-list")!.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

function handoffRow(handoff: HandoffSummary): string {
  return `<tr><td><span class="status-pill ${handoff.active ? "active" : "inactive"}">${handoff.active ? "Active" : "Closed"}</span></td><td>${handoff.uses}/${handoff.maxUses}</td><td>${date(handoff.expiresAt)}</td><td>${escape(handoff.audience || "Any holder")}</td><td>${handoff.active ? `<button class="button danger small" type="button" data-revoke="${escape(handoff.id)}">Revoke</button>` : ""}</td></tr>`;
}

async function revoke(id: string): Promise<void> {
  try { await client.revokeHandoff(id); notify("Handoff revoked."); await renderHandoffs(); } catch (error) { notify(messageOf(error), true); }
}

async function renderStatus(): Promise<void> {
  panel.innerHTML = `<section class="card"><h2>System status</h2><p class="hint">A quick view of this ${BRAND.productName} instance and its optional connectors.</p><div id="status-content">Loading…</div></section>`;
  try {
    const [{ stats }, { connectors }] = await Promise.all([client.stats(), client.connectors()]);
    document.getElementById("status-content")!.innerHTML = `<div class="stats-grid">${Object.entries(stats).filter(([, value]) => typeof value === "number").map(([key, value]) => `<div class="stat"><strong>${value}</strong><span>${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span></div>`).join("")}</div><h3>Connectors</h3><div class="connector-status">${connectors.map((connector) => `<div><span class="status-dot ${connector.configured ? "ready" : ""}"></span><strong>${escape(connector.label)}</strong><span>${escape(connector.detail)}</span></div>`).join("")}</div>`;
  } catch (error) { document.getElementById("status-content")!.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`; }
}

function claimList(title: string, claims: { text: string }[]): string {
  return claims.length ? `<h3>${title}</h3><ul>${claims.map((claim) => `<li>${escape(claim.text)}</li>`).join("")}</ul>` : "";
}
function escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function date(value: string): string { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function numberValue(id: string, fallback: number): number { return Number((document.getElementById(id) as HTMLInputElement).value) || fallback; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : "Something went wrong."; }
function notify(message: string, error = false): void { toast.hidden = false; toast.className = `toast ${error ? "error" : ""}`; toast.textContent = message; window.setTimeout(() => { toast.hidden = true; }, 3500); }
async function copy(value: string): Promise<void> { await navigator.clipboard?.writeText(value); notify("Copied to clipboard."); }