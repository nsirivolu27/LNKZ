import { BRAND } from "./branding";
import { client, getApiKey, setApiKey, type ConversationSummary, type HandoffSummary, type MembershipAuditEvent, type WorkspaceMembership } from "./api";
import { icon } from "./icons";
import "./styles.css";
import "./console.css";

type TabId = "import" | "library" | "packet" | "handoffs" | "status" | "team";
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "import", label: "Import", icon: "inbox" },
  { id: "library", label: "Library", icon: "message" },
  { id: "packet", label: "Context packet", icon: "braces" },
  { id: "handoffs", label: "Handoffs", icon: "key" },
  { id: "status", label: "Status", icon: "network" },
  { id: "team", label: "Team access", icon: "network" },
];
const state: { tab: TabId; selected: string | null } = { tab: "import", selected: null };
type QuickState = {
  conversations: ConversationSummary[];
  selected: string | null;
  loading: boolean;
  importing: boolean;
  sending: boolean;
  importOpen: boolean;
  detailsOpen: boolean;
  error: string;
  sent: { title: string; shareUrl: string; expiresAt: string; maxUses: number } | null;
};
const quickState: QuickState = {
  conversations: [],
  selected: null,
  loading: true,
  importing: false,
  sending: false,
  importOpen: false,
  detailsOpen: false,
  error: "",
  sent: null,
};
const app = document.getElementById("app")!;

app.innerHTML = `<div class="quick-app"><header class="quick-header"><a class="quick-brand" href="/"><span class="quick-brand-mark">${icon("link", 15)}</span><span><strong>LNKZ</strong><small>private handoff</small></span></a><div class="quick-header-actions"><span class="quick-private">${icon("shield", 14)} Stays private</span><a class="button secondary quick-sign-in" href="/api/login?returnTo=${encodeURIComponent("/console.html")}">Sign in</a></div></header><main id="panel" class="console-panel quick-panel"></main></div><div id="toast" class="toast" hidden></div>`;
const panel = document.getElementById("panel")!;
const toast = document.getElementById("toast")!;
void renderQuickSend();

function selectTab(tab: TabId): void {
  state.tab = tab;
  for (const candidate of tabs) document.getElementById(`tab-${candidate.id}`)!.classList.toggle("active", candidate.id === tab);
  if (tab === "import") renderImport();
  if (tab === "library") void renderLibrary();
  if (tab === "packet") renderPacket();
  if (tab === "handoffs") void renderHandoffs();
  if (tab === "status") void renderStatus();
  if (tab === "team") void renderTeam();
}

async function renderQuickSend(): Promise<void> {
  if (quickState.sent) {
    renderQuickSuccess();
    return;
  }
  if (quickState.importOpen) {
    renderQuickImport();
    return;
  }
  panel.innerHTML = quickSendMarkup();
  bindQuickSendEvents();
  if (quickState.loading) {
    try {
      const response = await client.listConversations({ limit: "6" });
      quickState.conversations = response.conversations;
      quickState.selected ??= quickState.conversations[0]?.id ?? null;
      quickState.loading = false;
      quickState.error = "";
      renderQuickSend();
    } catch (error) {
      quickState.loading = false;
      quickState.error = messageOf(error);
      renderQuickSend();
    }
  }
}

function quickSendMarkup(): string {
  const selected = quickState.conversations.find((conversation) => conversation.id === quickState.selected);
  const recent = quickState.conversations.length
    ? quickState.conversations.map((conversation) => `
      <button class="quick-conversation ${conversation.id === quickState.selected ? "selected" : ""}" type="button" data-conversation-id="${escape(conversation.id)}">
        <span class="quick-source">${escape(sourceInitials(conversation.source.provider))}</span>
        <span class="quick-conversation-copy"><strong>${escape(conversation.title)}</strong><small>${conversation.messageCount} messages · ${relativeDate(conversation.updatedAt)}</small></span>
        ${icon("arrow", 15)}
      </button>`).join("")
    : `<div class="quick-empty"><strong>No conversations yet</strong><span>Import one to create your first Claude handoff.</span></div>`;

  return `<div class="quick-card">
    <div class="quick-intro">
      <div class="quick-eyebrow"><span></span> quick handoff</div>
      <h1>Send the useful part.</h1>
      <p>Move one conversation into Claude and keep the context you need.</p>
    </div>
    <div class="quick-steps" aria-label="Handoff progress"><span class="active"><b>1</b> Choose</span><i></i><span><b>2</b> Send</span></div>
    ${quickState.error ? `<div class="quick-error" role="alert">${icon("alert", 15)}<span>${escape(quickState.error)}</span><button type="button" class="quick-link" data-action="retry">Try again</button></div>` : ""}
    <section class="quick-section">
      <div class="quick-section-head"><div><h2>Recent conversations</h2><p>Pick one to bring into your private space.</p></div></div>
      <div class="quick-conversations">${quickState.loading ? `<div class="quick-loading" aria-label="Loading conversations"><span></span><span></span><span></span></div>` : recent}</div>
      <button class="quick-import-link" type="button" data-action="import">${icon("inbox", 15)} Import conversation</button>
    </section>
    ${selected ? quickReadyMarkup(selected) : `<section class="quick-empty-ready"><span class="quick-empty-icon">${icon("message", 18)}</span><strong>Choose a conversation to continue</strong><p>Your handoff stays private until you create it.</p></section>`}
    <details class="quick-auth-details">
      <summary>Connection settings</summary>
      <form id="quick-api-key-form" class="quick-api-key-form">
        <label for="quick-api-key">${BRAND.apiKeyLabel}</label>
        <div><input id="quick-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${BRAND.apiKeyPlaceholder}" value="${escape(getApiKey())}" /><button type="submit" class="button secondary">Save</button></div>
        <small>Use sign-in above when managed authentication is enabled.</small>
      </form>
    </details>
  </div>`;
}

function quickReadyMarkup(conversation: ConversationSummary): string {
  const summary = conversation.summary?.trim() || `A portable handoff from ${conversation.source.provider}.`;
  return `<section class="quick-ready">
    <div class="quick-ready-label">Ready to send</div>
    <h2>${escape(conversation.title)}</h2>
    <p>${escape(summary)}</p>
    <div class="quick-meta"><span>${icon("file", 12)} ${conversation.messageCount} messages</span><span>${escape(conversation.source.provider)}</span><span>Private handoff</span></div>
    <button class="quick-disclosure" type="button" aria-expanded="${quickState.detailsOpen}" data-action="details"><span>What will be sent</span>${icon("chevron", 15)}</button>
    ${quickState.detailsOpen ? `<div class="quick-details"><p>The conversation will be packaged as an expiring link for <strong>Claude · My space</strong>. Source-specific workspace metadata is redacted.</p><ul><li>Conversation title and messages</li><li>A four-hour expiry</li><li>Two uses maximum</li></ul></div>` : ""}
    <div class="quick-destination"><span class="quick-destination-mark">C</span><span><small>Destination</small><strong>Claude · My space</strong></span><span class="quick-ready-status"><i></i> Ready</span></div>
    <button class="quick-send-button" type="button" data-action="send" ${quickState.sending ? "disabled" : ""}>${quickState.sending ? `<span class="quick-spinner"></span> Creating private handoff…` : `${icon("send", 15)} Create handoff for Claude`}</button>
    <p class="quick-note">${icon("shield", 12)} You’ll get a private link to open in Claude.</p>
  </section>`;
}

function bindQuickSendEvents(): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      quickState.selected = button.dataset.conversationId ?? null;
      quickState.sent = null;
      renderQuickSend();
    });
  });
  panel.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener("click", () => {
    quickState.importOpen = true;
    renderQuickSend();
  });
  panel.querySelector<HTMLButtonElement>('[data-action="details"]')?.addEventListener("click", () => {
    quickState.detailsOpen = !quickState.detailsOpen;
    renderQuickSend();
  });
  panel.querySelector<HTMLButtonElement>('[data-action="send"]')?.addEventListener("click", () => void sendQuickHandoff());
  panel.querySelector<HTMLButtonElement>('[data-action="retry"]')?.addEventListener("click", () => {
    quickState.loading = true;
    quickState.error = "";
    renderQuickSend();
  });
  panel.querySelector<HTMLFormElement>("#quick-api-key-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = panel.querySelector<HTMLInputElement>("#quick-api-key");
    setApiKey(input?.value.trim() ?? "");
    quickState.loading = true;
    quickState.error = "";
    notify(`${BRAND.apiKeyLabel} saved for this browser session.`);
    void renderQuickSend();
  });
}

async function sendQuickHandoff(): Promise<void> {
  const conversation = quickState.conversations.find((candidate) => candidate.id === quickState.selected);
  if (!conversation) return;
  quickState.sending = true;
  renderQuickSend();
  try {
    const handoff = await client.createHandoff(conversation.id, {
      ttlMinutes: 240,
      maxUses: 2,
      audience: "Claude · My space",
      note: "Prepared from the LNKZ quick handoff.",
      redact: true,
    });
    quickState.sent = { title: conversation.title, shareUrl: handoff.shareUrl, expiresAt: handoff.expiresAt, maxUses: handoff.maxUses };
    quickState.sending = false;
    renderQuickSend();
  } catch (error) {
    quickState.sending = false;
    quickState.error = messageOf(error);
    renderQuickSend();
  }
}

function renderQuickSuccess(): void {
  const sent = quickState.sent;
  if (!sent) return;
  panel.innerHTML = `<div class="quick-success-card">
    <div class="quick-success-mark">${icon("check", 21)}</div>
    <div class="quick-eyebrow"><span></span> ready for Claude</div>
    <h1>Your handoff is ready.</h1>
    <p><strong>${escape(sent.title)}</strong> is packaged for Claude · My space.</p>
    <div class="quick-share-box"><span>${icon("link", 14)} Private handoff link</span><button type="button" class="button secondary" data-action="copy">${icon("copy", 14)} Copy link</button><code>${escape(sent.shareUrl)}</code></div>
    <div class="quick-success-meta"><span>Expires ${escape(date(sent.expiresAt))}</span><span>${sent.maxUses} uses</span><span>Source metadata redacted</span></div>
    <div class="quick-success-actions"><a class="quick-send-button" href="${escape(sent.shareUrl)}" target="_blank" rel="noreferrer">${icon("arrow", 15)} Open handoff</a><button class="button secondary" type="button" data-action="again">Send another</button></div>
    <p class="quick-note">${icon("shield", 12)} Open this link from Claude when you’re ready to continue.</p>
  </div>`;
  panel.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener("click", () => void copy(sent.shareUrl));
  panel.querySelector<HTMLButtonElement>('[data-action="again"]')?.addEventListener("click", () => {
    quickState.sent = null;
    quickState.detailsOpen = false;
    renderQuickSend();
  });
}

function renderQuickImport(): void {
  panel.innerHTML = `<div class="quick-import-card">
    <button class="quick-back" type="button" data-action="back">${icon("arrowLeft", 15)} Back to recent conversations</button>
    <div class="quick-eyebrow"><span></span> bring a conversation in</div>
    <h1>Start with a conversation.</h1>
    <p>Paste a copied chat or export. LNKZ keeps the source intact and prepares it for a private Claude handoff.</p>
    <form id="quick-import-form">
      <div class="quick-import-fields"><label for="quick-import-format">Source<select id="quick-import-format"><option value="auto">Detect automatically</option><option value="chatgpt">ChatGPT export</option><option value="claude">Claude export</option><option value="gemini">Gemini export</option><option value="markdown">Markdown</option><option value="text">Plain text</option></select></label><div class="quick-import-hint">LNKZ will keep the imported title and source information.</div></div>
      <label for="quick-import-data">Conversation<textarea id="quick-import-data" rows="9" placeholder="Paste the conversation here"></textarea></label>
      <div id="quick-import-error" class="quick-error" hidden role="alert"></div>
      <div class="quick-form-actions"><button class="button secondary" type="button" data-action="back">Cancel</button><button class="quick-send-button" type="submit" ${quickState.importing ? "disabled" : ""}>${quickState.importing ? `<span class="quick-spinner"></span> Importing…` : `${icon("inbox", 15)} Import conversation`}</button></div>
    </form>
  </div>`;
  panel.querySelectorAll<HTMLButtonElement>('[data-action="back"]').forEach((button) => button.addEventListener("click", () => {
    quickState.importOpen = false;
    renderQuickSend();
  }));
  panel.querySelector<HTMLFormElement>("#quick-import-form")?.addEventListener("submit", (event) => void importQuickConversation(event));
}

async function importQuickConversation(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const data = panel.querySelector<HTMLTextAreaElement>("#quick-import-data")?.value.trim() ?? "";
  const format = panel.querySelector<HTMLSelectElement>("#quick-import-format")?.value ?? "auto";
  const errorBox = panel.querySelector<HTMLElement>("#quick-import-error");
  if (!data) {
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = "Paste a conversation first.";
    }
    return;
  }
  quickState.importing = true;
  renderQuickImport();
  try {
    const result = await client.importPayload({ payload: data, format });
    const imported = result.conversations ?? [];
    if (!imported.length) throw new Error("No conversation was found in that import.");
    quickState.conversations = [...imported, ...quickState.conversations.filter((conversation) => !imported.some((candidate) => candidate.id === conversation.id))];
    quickState.selected = imported[0].id;
    quickState.importOpen = false;
    quickState.importing = false;
    quickState.error = "";
    notify("Conversation imported and ready to send.");
    renderQuickSend();
  } catch (error) {
    quickState.importing = false;
    renderQuickImport();
    const nextError = panel.querySelector<HTMLElement>("#quick-import-error");
    if (nextError) {
      nextError.hidden = false;
      nextError.textContent = messageOf(error);
    }
  }
}

function sourceInitials(provider: string): string {
  const value = provider.trim();
  return value.length <= 3 ? value.toUpperCase() : value.slice(0, 2).toUpperCase();
}

function relativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

async function renderTeam(): Promise<void> {
  panel.innerHTML = `<section class="card"><div class="section-heading"><div><h2>Team access</h2><p class="hint">Add provider identities, control their scopes, and deactivate access without touching the database.</p></div><span class="status-pill active">Admin only</span></div><form id="membership-add-form" class="membership-add"><div class="row"><label>Issuer<input id="membership-issuer" type="url" required placeholder="https://replit.com/oidc" /></label><label>Provider subject<input id="membership-subject" type="text" required placeholder="The provider subject identifier" /></label></div><fieldset class="scope-list"><legend>Scopes</legend>${scopeCheckboxes("add-scope", ["read", "write"])}</fieldset><div class="actions"><button class="button primary" type="submit">Add membership ${icon("arrow", 16)}</button></div></form><div id="membership-result" class="result" hidden></div><div id="membership-list" class="table-wrap"><p class="hint">Loading memberships…</p></div></section><section class="card membership-history"><div class="section-heading"><div><h2>Membership history</h2><p class="hint">Review who changed access, which provider subject was affected, and how scopes or status changed.</p></div><span class="status-pill active">Workspace scoped</span></div><div id="membership-history-list" class="table-wrap"><p class="hint">Loading history…</p></div></section>`;
  const addForm = document.getElementById("membership-add-form")!;
  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addMembership();
  });
  try {
    const [{ memberships }, { events }] = await Promise.all([
      client.listMemberships(true),
      client.listMembershipEvents(),
    ]);
    renderMembershipList(memberships);
    renderMembershipHistory(events);
  } catch (error) {
    document.getElementById("membership-list")!.innerHTML = `<p class="hint">${escape(messageOf(error))}</p>`;
    document.getElementById("membership-history-list")!.innerHTML = `<p class="hint">${escape(messageOf(error))}</p>`;
  }
}

function renderMembershipList(memberships: WorkspaceMembership[]): void {
  const list = document.getElementById("membership-list")!;
  if (!memberships.length) {
    list.innerHTML = `<p class="empty-state">No memberships yet. Add a provider subject above to grant workspace access.</p>`;
    return;
  }
  list.innerHTML = `<table class="table membership-table"><thead><tr><th>Provider subject</th><th>Actor</th><th>Scopes</th><th>Status</th><th>Actions</th></tr></thead><tbody>${memberships.map((membership, index) => membershipRow(membership, index)).join("")}</tbody></table>`;
  memberships.forEach((membership, index) => {
    const row = document.querySelector<HTMLElement>(`[data-membership-index="${index}"]`)!;
    row.querySelector<HTMLButtonElement>(".membership-save")?.addEventListener("click", () => void updateMembership(membership, row));
    row.querySelector<HTMLButtonElement>(".membership-deactivate")?.addEventListener("click", () => void setMembershipActive(membership, false));
    row.querySelector<HTMLButtonElement>(".membership-reactivate")?.addEventListener("click", () => void setMembershipActive(membership, true));
  });
}

function membershipRow(membership: WorkspaceMembership, index: number): string {
  const scopes = ["read", "write", "mcp", "admin"] as const;
  return `<tr class="membership-row" data-membership-index="${index}"><td><strong>${escape(membership.subject)}</strong><span class="snippet">${escape(membership.issuer)}</span></td><td>${escape(membership.actorId)}</td><td><div class="scope-list compact">${scopes.map((scope) => `<label class="scope-option"><input class="scope-checkbox" type="checkbox" value="${scope}" ${membership.scopes.includes(scope) ? "checked" : ""} ${membership.active ? "" : "disabled"} />${scope}</label>`).join("")}</div></td><td><span class="status-pill ${membership.active ? "active" : "inactive"}">${membership.active ? "Active" : "Inactive"}</span></td><td><div class="membership-actions">${membership.active ? `<button class="button secondary small membership-save" type="button">Save scopes</button><button class="button danger small membership-deactivate" type="button">Deactivate</button>` : `<button class="button secondary small membership-reactivate" type="button">Reactivate</button>`}</div></td></tr>`;
}

function renderMembershipHistory(events: MembershipAuditEvent[]): void {
  const list = document.getElementById("membership-history-list")!;
  if (!events.length) {
    list.innerHTML = `<p class="empty-state">No membership changes have been recorded yet.</p>`;
    return;
  }
  list.innerHTML = `<table class="table membership-history-table"><thead><tr><th>Changed</th><th>Action</th><th>Acting admin</th><th>Provider subject</th><th>Scopes</th><th>Status transition</th></tr></thead><tbody>${events.map(membershipHistoryRow).join("")}</tbody></table>`;
}

function membershipHistoryRow(event: MembershipAuditEvent): string {
  const current = event.detail?.membership;
  if (!current) return "";
  const previous = event.detail?.previous;
  const action = event.kind === "workspace_membership.created"
    ? "Membership created"
    : event.kind === "workspace_membership.deactivated"
      ? "Membership deactivated"
      : "Membership updated";
  const currentScopes = current.scopes.join(", ") || "None";
  const previousScopes = previous?.scopes.join(", ");
  const scopes = previousScopes && previousScopes !== currentScopes
    ? `<strong>${escape(currentScopes)}</strong><span class="snippet">from ${escape(previousScopes)}</span>`
    : `<strong>${escape(currentScopes)}</strong>`;
  const previousStatus = previous ? membershipStatus(previous.active) : "—";
  return `<tr><td>${date(event.at)}</td><td>${action}</td><td>${escape(event.actorId || "System")}</td><td><strong>${escape(current.subject)}</strong><span class="snippet">${escape(current.issuer)}</span></td><td>${scopes}</td><td>${escape(previousStatus)} → ${escape(membershipStatus(current.active))}</td></tr>`;
}

function membershipStatus(active: boolean): string {
  return active ? "Active" : "Inactive";
}

async function addMembership(): Promise<void> {
  const issuer = (document.getElementById("membership-issuer") as HTMLInputElement).value.trim();
  const subject = (document.getElementById("membership-subject") as HTMLInputElement).value.trim();
  const scopes = selectedScopes("add-scope");
  try {
    await client.addMembership({ issuer, subject, scopes });
    notify("Membership added.");
    void renderTeam();
  } catch (error) {
    notify(messageOf(error), true);
  }
}

async function updateMembership(membership: WorkspaceMembership, row: HTMLElement): Promise<void> {
  const scopes = [...row.querySelectorAll<HTMLInputElement>(".scope-checkbox:checked")].map((input) => input.value) as WorkspaceMembership["scopes"];
  if (!scopes.length) {
    notify("Select at least one scope.", true);
    return;
  }
  try {
    await client.updateMembership({ issuer: membership.issuer, subject: membership.subject, scopes });
    notify("Membership scopes updated.");
    void renderTeam();
  } catch (error) {
    notify(messageOf(error), true);
  }
}

async function setMembershipActive(membership: WorkspaceMembership, active: boolean): Promise<void> {
  if (!active && !window.confirm(`Deactivate access for ${membership.subject}?`)) return;
  try {
    await client.updateMembership({ issuer: membership.issuer, subject: membership.subject, active });
    notify(active ? "Membership reactivated." : "Membership deactivated.");
    void renderTeam();
  } catch (error) {
    notify(messageOf(error), true);
  }
}

function selectedScopes(prefix: string): WorkspaceMembership["scopes"] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${prefix}"]:checked`)].map((input) => input.value) as WorkspaceMembership["scopes"];
}

function scopeCheckboxes(name: string, selected: string[]): string {
  return (["read", "write", "mcp", "admin"] as const).map((scope) => `<label class="scope-option"><input type="checkbox" name="${name}" value="${scope}" ${selected.includes(scope) ? "checked" : ""} />${scope}</label>`).join("");
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