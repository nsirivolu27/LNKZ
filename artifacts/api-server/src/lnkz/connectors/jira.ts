import { fetchJson, textFromUnknown } from "../http.js";
import type { Connector, ContextItem } from "../types.js";

interface JiraSearchResponse {
  issues?: Array<{
    id: string;
    key: string;
    fields?: {
      summary?: string;
      description?: unknown;
      status?: { name?: string };
      assignee?: { displayName?: string } | null;
      updated?: string;
      project?: { name?: string };
    };
  }>;
}

export function createJiraConnector(env: NodeJS.ProcessEnv = process.env): Connector | null {
  const baseUrl = env.JIRA_BASE_URL?.trim().replace(/\/$/, "");
  const email = env.JIRA_EMAIL?.trim();
  const token = env.JIRA_API_TOKEN?.trim();
  if (!baseUrl || !email || !token) return null;

  return {
    id: "jira",
    label: "Jira Cloud",
    status: () => ({
      id: "jira",
      label: "Jira Cloud",
      configured: true,
      detail: `Enhanced JQL search is configured for ${new URL(baseUrl).hostname}.`,
    }),
    search: async (query, limit) => {
      const response = await fetchJson<JiraSearchResponse>(`${baseUrl}/rest/api/3/search/jql`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jql: `text ~ "${escapeJql(query)}" ORDER BY updated DESC`,
          maxResults: Math.min(limit, 50),
          fields: ["summary", "description", "status", "assignee", "updated", "project"],
        }),
      });
      return (response.issues ?? []).map((issue): ContextItem => ({
        source: "jira",
        id: issue.key || issue.id,
        title: `${issue.key}: ${issue.fields?.summary ?? "Untitled issue"}`,
        text: textFromUnknown(issue.fields?.description) || issue.fields?.summary || "",
        url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`,
        updatedAt: issue.fields?.updated,
        metadata: {
          status: issue.fields?.status?.name,
          assignee: issue.fields?.assignee?.displayName,
          project: issue.fields?.project?.name,
        },
      }));
    },
  };
}

function escapeJql(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
