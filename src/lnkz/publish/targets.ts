import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { looksLikeWrite, type RemoteTool } from "./prepare.js";

/**
 * The MCP servers LNKZ can send context to.
 *
 * Configured as `LNKZ_MCP_TARGETS`, a comma-separated list of `name=url` with an
 * optional `|key`:
 *
 *   LNKZ_MCP_TARGETS=jira=https://jira.example/mcp|abc123,notes=http://localhost:9000/mcp
 *
 * The existing `FANTASY_MCP_URL` stays a target so nothing that already worked
 * stops working. Parsing is deliberately forgiving about whitespace and strict
 * about everything else: a malformed entry is reported, not guessed at, because
 * a typo in a URL here is a request sent somewhere unintended.
 */

export interface PublishTarget {
  name: string;
  url: string;
  apiKey?: string;
}

export interface TargetTools {
  target: string;
  url: string;
  tools: (RemoteTool & { write: boolean })[];
  error?: string;
}

export function configuredTargets(env: NodeJS.ProcessEnv = process.env): { targets: PublishTarget[]; errors: string[] } {
  const targets: PublishTarget[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const add = (name: string, url: string, apiKey?: string) => {
    if (seen.has(name)) {
      errors.push(`Duplicate target name "${name}" was ignored.`);
      return;
    }
    try {
      // Throws on anything that is not a real absolute URL.
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push(`Target "${name}" is not http or https and was ignored.`);
        return;
      }
    } catch {
      errors.push(`Target "${name}" has an unparseable URL and was ignored.`);
      return;
    }
    seen.add(name);
    targets.push({ name, url, apiKey: apiKey || undefined });
  };

  for (const entry of (env.LNKZ_MCP_TARGETS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      errors.push(`Target entry "${entry}" is not in name=url form and was ignored.`);
      continue;
    }
    const name = entry.slice(0, separator).trim();
    const [url, apiKey] = entry.slice(separator + 1).split("|").map((value) => value.trim());
    add(name, url ?? "", apiKey);
  }

  const fantasy = env.FANTASY_MCP_URL?.trim();
  if (fantasy) add("fantasy", fantasy, env.FANTASY_MCP_API_KEY?.trim());

  return { targets, errors };
}

export type ToolLister = (target: PublishTarget) => Promise<RemoteTool[]>;

/**
 * Discovery is a live call, so it is injected. Tests drive the mapping and the
 * reporting without a network, and without a fake server standing in for one.
 */
export async function discoverTools(
  targets: PublishTarget[],
  list: ToolLister = listToolsOverHttp,
): Promise<TargetTools[]> {
  const results = await Promise.allSettled(
    targets.map(async (target) => ({ target, tools: await list(target) })),
  );

  return results.map((result, index) => {
    const target = targets[index];
    if (result.status === "rejected") {
      return {
        target: target.name,
        url: target.url,
        tools: [],
        error: result.reason instanceof Error ? result.reason.message : "Discovery failed.",
      };
    }
    return {
      target: target.name,
      url: target.url,
      tools: result.value.tools.map((tool) => ({ ...tool, write: looksLikeWrite(tool) })),
    };
  });
}

export function findTool(discovered: TargetTools[], targetName: string, toolName: string): RemoteTool | null {
  const target = discovered.find((entry) => entry.target === targetName);
  return target?.tools.find((tool) => tool.name === toolName) ?? null;
}

async function listToolsOverHttp(target: PublishTarget): Promise<RemoteTool[]> {
  const client = new Client({ name: "lnkz", version: "0.2.0" });
  const headers: Record<string, string> = {};
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  const transport = new StreamableHTTPClientTransport(new URL(target.url), { requestInit: { headers } });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as RemoteTool["inputSchema"],
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}
