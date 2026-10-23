import { client, getApiKey, setApiKey, type Analysis, type ConversationSummary, type HandoffSummary } from "./api";
import { icon } from "./icons";
import "./styles.css";
import "./console.css";

type TabId = "import" | "library" | "packet" | "handoffs" | "status";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "import", label: "Import", icon: "inbox" },
  { id: "library", label: "Library", icon: "message" },
  { id: "packet", label: "Context packet", icon: "braces" },
  { id: "handoffs", label: "Handoffs", icon: "key" },
  { id: "status", label: "Status", icon: "network" },
];

const state: { tab: TabId; selected: string | null } = { tab: "import", selected: null };

const app = document.getElementById("app")!;
app.innerHTML = shell();

const panel = document.getElementById("panel")!;
const toast = document.getElementById("toast")!;
const keyInput = document.getElementById("api-key") as HTMLInputElement;

keyInput.value = getApiKey();
keyInput.addEventListener("change", () => {
  setApiKey(keyInput.value.trim());
  notify("API key saved for this browser session.");
});

for (const tab of TABS) {
  document.getElementById(`tab-${tab.id}`)!.addEventListener("click", () => selectTab(tab.id));
}

selectTab("import");

// --------------------------------------------------------------------- shell

function shell(): string {
  return `
<header class="console-header">
  <a class="brand" href="/"><span class="brand-mark">${icon("link", 19)}</span><span>LNKZ</span></a>
  <div class="key-field">
    <label for="api-key">API key</label>
    <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="LNKZ_API_KEY (leave blank if unset)" />
  </div>
</header>
<nav class="console-tabs">
  ${TABS.map((tab) => `<button id="tab-${tab.id}" class="console-tab" type="button">${icon(tab.icon, 16)} ${tab.label}</button>`).join("")}
</nav>
<main id="panel" class="console-panel"></main>
<div id="toast" class="toast" hidden></div>`;
}

function selectTab(tab: TabId): void {
  state.tab = tab;
  for (const candidate of TABS) {
    document.getElementById(`tab-${candidate.id}`)!.classList.toggle("active", candidate.id === tab);
  }
  if (tab === "import") renderImport();
  if (tab === "library") void renderLibrary();
  if (tab === "packet") renderPacket();
  if (tab === "handoffs") void renderHandoffs();
  if (tab === "status") void renderStatus();
}

// -------------------------------------------------------------------- import

function renderImport(): void {
  panel.innerHTML = `
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
    <button id="import-run" class="button primary" type="button">Import ${icon("arrow", 16)}</button>
  </div>
  <div id="import-result" class="result" hidden></div>
</section>`;

  const payload = document.getElementById("import-payload") as HTMLTextAreaElement;
  const format = document.getElementById("import-format") as HTMLSelectElement;
  const tags = document.getElementById("import-tags") as HTMLInputElement;
  const result = document.getElementById("import-result")!;

  const run = async (dryRun: boolean) => {
    if (!payload.value.trim()) {
      notify("Paste something to import first.", true);
      return;
    }
    await guard(result, async () => {
      const response = await client.importPayload({
        payload: payload.value,
        format: format.value,
        tags: splitTags(tags.value),
        dryRun,
      });
      const warnings = response.warnings.map((warning) => `<li class="warn">${escape(warning)}</li>`).join("");
      if (dryRun) {
        const preview = (response.preview ?? []) as { title: string; provider: string; messages: number }[];
        return `<p>Detected <strong>${escape(response.format)}</strong>. Nothing was written.</p>
          <ul>${preview.map((item) => `<li>${escape(item.title)} — ${item.messages} messages from ${escape(item.provider)}</li>`).join("")}${warnings}</ul>`;
      }
      const saved = response.conversations ?? [];
      return `<p>Imported <strong>${saved.length}</strong> conversation(s) as ${escape(response.format)}.</p>
        <ul>${saved.map((item) => `<li>${escape(item.title)} <code>${item.id}</code></li>`).join("")}${warnings}</ul>`;
    });
  };

  document.getElementById("import-preview")!.addEventListener("click", () => void run(true));
  document.getElementById("import-run")!.addEventListener("click", () => void run(false));
}

// ------------------------------------------------------------------- library

async function renderLibrary(): Promise<void> {
  panel.innerHTML = `
<section class="split">
  <div class="card list-card">
    <div class="row">
      <input id="library-search" type="search" placeholder="Search saved conversations" />
      <button id="library-refresh" class="button secondary" type="button">Refresh</button>
    </div>
    <div id="library-list" class="list">Loading…</div>
  </div>
  <div id="library-detail" class="card detail-card"><p class="hint">Select a conversation to see what it settled and to hand it off.</p></div>
</section>`;

  const search = document.getElementById("library-search") as HTMLInputElement;
  const list = document.getElementById("library-list")!;

  const load = async () => {
    list.textContent = "Loading…";
    try {
      const items = search.value.trim()
        ? (await client.searchConversations(search.value.trim())).matches
        : (await client.listConversations({ limit: "50" })).conversations;
      list.innerHTML = items.length
        ? items.map(conversationRow).join("")
        : `<p class="hint">Nothing here yet. Import a conversation to get started.</p>`;
      for (const node of list.querySelectorAll<HTMLElement>("[data-id]")) {
        node.addEventListener("click", () => void showConversation(node.dataset.id!));
      }
    } catch (error) {
      list.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`;
    }
  };

  let timer: number | undefined;
  search.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(), 250);
  });
  document.getElementById("library-refresh")!.addEventListener("click", () => void load());
  await load();
  if (state.selected) await showConversation(state.selected);
}

function conversationRow(item: ConversationSummary & { relevance?: number; snippet?: string }): string {
  return `
<button class="list-row" data-id="${item.id}" type="button">
  <strong>${escape(item.title)}</strong>
  <span class="meta">${escape(item.source.provider)} · ${item.messageCount} messages · ${shortDate(item.updatedAt)}</span>
  ${item.snippet ? `<span class="snippet">${escape(item.snippet)}</span>` : ""}
</button>`;
}

async function showConversation(id: string): Promise<void> {
  state.selected = id;
  const detail = document.getElementById("library-detail");
  if (!detail) return;
  detail.innerHTML = "Loading…";
  try {
    const { conversation, analysis } = await client.getConversation(id);
    detail.innerHTML = `
<h2>${escape(conversation.title)}</h2>
<p class="meta">${escape(conversation.source.provider)}${conversation.source.app ? ` / ${escape(conversation.source.app)}` : ""}
 · ${conversation.messageCount} messages · roughly ${analysis.approxTokens} tokens</p>
${conversation.lineage?.parentId ? `<p class="meta">Continued from <code>${conversation.lineage.parentId}</code></p>` : ""}
${claimList("Decisions", analysis.decisions)}
${claimList("Open questions", analysis.openQuestions)}
${claimList("Action items", analysis.actionItems)}
${analysis.topics.length ? `<p class="tags">${analysis.topics.slice(0, 10).map((topic) => `<span>${escape(topic)}</span>`).join("")}</p>` : ""}

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
  <button id="handoff-create" class="button primary" type="button">Create handoff ${icon("key", 16)}</button>
  <button id="conversation-delete" class="button danger" type="button">Delete</button>
</div>
<div id="handoff-result" class="result" hidden></div>

<h3>Transcript</h3>
<div class="transcript">
  ${conversation.messages.map((message) => `
    <article class="bubble ${message.role}">
      <span>${escape(message.author || message.role)}</span>
      <p>${escape(message.content)}</p>
    </article>`).join("")}
</div>`;

    document.getElementById("handoff-create")!.addEventListener("click", () => void createHandoff(id));
    document.getElementById("conversation-delete")!.addEventListener("click", () => void deleteConversation(id));
  } catch (error) {
    detail.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`;
  }
}

async function createHandoff(id: string): Promise<void> {
  const result = document.getElementById("handoff-result")!;
  await guard(result, async () => {
    const handoff = await client.createHandoff(id, {
      ttlMinutes: numberValue("handoff-ttl", 60),
      maxUses: numberValue("handoff-uses", 3),
      audience: (document.getElementById("handoff-audience") as HTMLInputElement).value.trim() || undefined,
      redact: (document.getElementById("handoff-redact") as HTMLInputElement).checked,
    });
    return `<p>Share this link. It expires ${shortDate(handoff.expiresAt)} after up to ${handoff.maxUses} use(s).</p>
      <div class="copy-row"><code id="share-url">${escape(handoff.shareUrl)}</code>
      <button class="button secondary" type="button" data-copy="${escape(handoff.shareUrl)}">Copy</button></div>
      <p class="hint">Anyone holding this link can read the conversation until it expires. Revoke it from the Handoffs tab.</p>`;
  });
  for (const button of result.querySelectorAll<HTMLElement>("[data-copy]")) {
    button.addEventListener("click", () => void copy(button.dataset.copy!));
  }
}

async function deleteConversation(id: string): Promise<void> {
  try {
    await client.deleteConversation(id);
    state.selected = null;
    notify("Conversation deleted.");
    await renderLibrary();
  } catch (error) {
    notify(messageOf(error), true);
  }
}

// -------------------------------------------------------------------- packet

function renderPacket(): void {
  panel.innerHTML = `
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
    <button id="packet-build" class="button primary" type="button">Build packet ${icon("arrow", 16)}</button>
  </div>
  <div id="packet-result" class="result" hidden></div>
</section>`;

  document.getElementById("packet-build")!.addEventListener("click", () => {
    const result = document.getElementById("packet-result")!;
    void guard(result, async () => {
      const query = (document.getElementById("packet-query") as HTMLInputElement).value.trim();
      if (!query) throw new Error("Enter a query first.");
      const { packet } = await client.buildPacket({
        query,
        budgetTokens: numberValue("packet-budget", 4_000),
        includeExternal: (document.getElementById("packet-external") as HTMLInputElement).checked,
      });
      return `<p class="meta">${packet.usedTokens} of ${packet.budgetTokens} approx tokens · ${packet.conversations.length} conversation(s)</p>
        ${packet.conflicts.length ? `<p class="warn">${packet.conflicts.length} possible contradiction(s) flagged.</p>` : ""}
        <div class="copy-row"><button class="button secondary" type="button" data-copy-packet="1">Copy packet</button></div>
        <pre class="packet" id="packet-markdown">${escape(packet.markdown)}</pre>`;
    }).then(() => {
      const button = result.querySelector<HTMLElement>("[data-copy-packet]");
      button?.addEventListener("click", () => void copy(document.getElementById("packet-markdown")!.textContent ?? ""));
    });
  });
}

// ------------------------------------------------------------------ handoffs

async function renderHandoffs(): Promise<void> {
  panel.innerHTML = `<section class="card"><h2>Handoffs</h2><div id="handoff-list">Loading…</div></section>`;
  const list = document.getElementById("handoff-list")!;
  try {
    const { handoffs } = await client.listHandoffs();
    list.innerHTML = handoffs.length
      ? `<table class="table"><thead><tr><th>Status</th><th>Uses</th><th>Expires</th><th>Audience</th><th>Redacted</th><th></th></tr></thead>
         <tbody>${handoffs.map(handoffRow).join("")}</tbody></table>`
      : `<p class="hint">No handoffs issued yet.</p>`;
    for (const button of list.querySelectorAll<HTMLElement>("[data-revoke]")) {
      button.addEventListener("click", async () => {
        try {
          await client.revokeHandoff(button.dataset.revoke!);
          notify("Handoff revoked.");
          await renderHandoffs();
        } catch (error) {
          notify(messageOf(error), true);
        }
      });
    }
  } catch (error) {
    list.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`;
  }
}

function handoffRow(handoff: HandoffSummary): string {
  return `
<tr>
  <td><span class="pill ${handoff.active ? "on" : "off"}">${handoff.active ? "active" : handoff.revokedAt ? "revoked" : "spent"}</span></td>
  <td>${handoff.uses}/${handoff.maxUses}</td>
  <td>${shortDate(handoff.expiresAt)}</td>
  <td>${escape(handoff.audience ?? "—")}</td>
  <td>${handoff.redact ? "yes" : "no"}</td>
  <td>${handoff.active ? `<button class="button danger small" type="button" data-revoke="${handoff.id}">Revoke</button>` : ""}</td>
</tr>`;
}

// -------------------------------------------------------------------- status

async function renderStatus(): Promise<void> {
  panel.innerHTML = `<section class="card"><h2>Status</h2><div id="status-body">Loading…</div></section>`;
  const body = document.getElementById("status-body")!;
  try {
    const [{ connectors }, { stats }, { events }] = await Promise.all([
      client.connectors(),
      client.stats(),
      client.events(),
    ]);
    body.innerHTML = `
<div class="stat-row">
  <div><strong>${stats.conversations}</strong><span>conversations</span></div>
  <div><strong>${stats.messages}</strong><span>messages</span></div>
  <div><strong>${stats.activeHandoffs}</strong><span>active handoffs</span></div>
  <div><strong>${stats.events}</strong><span>audit events</span></div>
</div>
<h3>Providers</h3>
<p class="tags">${stats.providers.length
  ? stats.providers.map((entry) => `<span>${escape(entry.provider)} · ${entry.count}</span>`).join("")
  : "<span>none yet</span>"}</p>
<h3>Connectors</h3>
<ul class="connector-list">
  ${connectors.map((connector) => `<li><span class="pill ${connector.configured ? "on" : "off"}">${connector.configured ? "on" : "off"}</span>
    <strong>${escape(connector.label)}</strong><small>${escape(connector.detail)}</small></li>`).join("")}
</ul>
<h3>Recent events</h3>
<ul class="event-list">
  ${events.map((event) => `<li><code>${escape(event.kind)}</code> <span class="meta">${shortDate(event.at)}</span></li>`).join("")
    || "<li class='hint'>No events yet.</li>"}
</ul>`;
  } catch (error) {
    body.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`;
  }
}

// -------------------------------------------------------------------- helpers

async function guard(target: HTMLElement, work: () => Promise<string>): Promise<void> {
  target.hidden = false;
  target.innerHTML = "Working…";
  try {
    target.innerHTML = await work();
  } catch (error) {
    target.innerHTML = `<p class="error">${escape(messageOf(error))}</p>`;
  }
}

function claimList(heading: string, claims: { text: string }[]): string {
  if (!claims.length) return "";
  return `<h3>${heading}</h3><ul>${claims.slice(0, 8).map((claim) => `<li>${escape(claim.text)}</li>`).join("")}</ul>`;
}

async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    notify("Copied.");
  } catch {
    notify("Copying was blocked; select the text instead.", true);
  }
}

function notify(message: string, isError = false): void {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 3_200);
}

function numberValue(id: string, fallback: number): number {
  const parsed = Number((document.getElementById(id) as HTMLInputElement).value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type { Analysis };
