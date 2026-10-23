import { fetchJson, matchesQuery } from "../http.js";
import type { Connector, ContextItem } from "../types.js";

interface SlackSearchResponse {
  ok: boolean;
  error?: string;
  messages?: { matches?: Array<{
    ts?: string;
    text?: string;
    permalink?: string;
    channel_name?: string;
    username?: string;
  }> };
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{ ts?: string; text?: string; user?: string }>;
}

export function createSlackConnector(env: NodeJS.ProcessEnv = process.env): Connector | null {
  const userToken = env.SLACK_USER_TOKEN?.trim();
  const botToken = env.SLACK_BOT_TOKEN?.trim();
  const channels = (env.SLACK_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!userToken && (!botToken || channels.length === 0)) return null;

  return {
    id: "slack",
    label: "Slack",
    status: () => ({
      id: "slack",
      label: "Slack",
      configured: true,
      detail: userToken
        ? "Workspace message search is configured."
        : `Recent history search is configured for ${channels.length} channel(s).`,
    }),
    search: async (query, limit) => userToken
      ? searchWorkspace(userToken, query, limit)
      : searchChannelHistory(botToken as string, channels, query, limit),
  };
}

async function searchWorkspace(token: string, query: string, limit: number): Promise<ContextItem[]> {
  const url = new URL("https://slack.com/api/search.messages");
  url.searchParams.set("query", query);
  url.searchParams.set("count", String(Math.min(limit, 100)));
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("sort_dir", "desc");
  const body = await fetchJson<SlackSearchResponse>(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!body.ok) throw new Error(`Slack search failed: ${body.error ?? "unknown error"}`);
  return (body.messages?.matches ?? []).map((message) => ({
    source: "slack",
    id: message.ts ?? message.permalink ?? message.text ?? "message",
    title: message.channel_name ? `#${message.channel_name}` : "Slack message",
    text: message.text ?? "",
    url: message.permalink,
    updatedAt: slackTimestamp(message.ts),
    metadata: { username: message.username },
  }));
}

async function searchChannelHistory(
  token: string,
  channels: string[],
  query: string,
  limit: number,
): Promise<ContextItem[]> {
  const pages = await Promise.all(channels.map(async (channel) => {
    const body = await fetchJson<SlackHistoryResponse>("https://slack.com/api/conversations.history", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel, limit: Math.min(15, limit) }),
    });
    if (!body.ok) throw new Error(`Slack history failed for ${channel}: ${body.error ?? "unknown error"}`);
    return (body.messages ?? [])
      .filter((message) => matchesQuery(query, message.text))
      .map((message): ContextItem => ({
        source: "slack",
        id: `${channel}:${message.ts ?? message.text ?? "message"}`,
        title: `Slack channel ${channel}`,
        text: message.text ?? "",
        updatedAt: slackTimestamp(message.ts),
        metadata: { channel, user: message.user },
      }));
  }));
  return pages.flat().slice(0, limit);
}

function slackTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}
