import { fetchJson, matchesQuery } from "../http.js";
import type { Connector, ContextItem } from "../types.js";

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  children?: FigmaNode[];
}

interface FigmaFile {
  name?: string;
  lastModified?: string;
  version?: string;
  document?: FigmaNode;
}

export function createFigmaConnector(env: NodeJS.ProcessEnv = process.env): Connector | null {
  const personalToken = env.FIGMA_PERSONAL_ACCESS_TOKEN?.trim();
  const accessToken = env.FIGMA_ACCESS_TOKEN?.trim();
  const fileKeys = (env.FIGMA_FILE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if ((!personalToken && !accessToken) || fileKeys.length === 0) return null;
  const headers: Record<string, string> = personalToken
    ? { "x-figma-token": personalToken }
    : { authorization: `Bearer ${accessToken as string}` };

  return {
    id: "figma",
    label: "Figma",
    status: () => ({
      id: "figma",
      label: "Figma",
      configured: true,
      detail: `Bounded file search is configured for ${fileKeys.length} file(s).`,
    }),
    search: async (query, limit) => {
      const files = await Promise.all(fileKeys.map(async (fileKey) => ({
        fileKey,
        file: await fetchJson<FigmaFile>(
          `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=3`,
          { headers },
        ),
      })));
      const items: ContextItem[] = [];
      for (const { fileKey, file } of files) {
        for (const node of walk(file.document)) {
          if (!matchesQuery(query, file.name, node.name, node.characters, node.type)) continue;
          items.push({
            source: "figma",
            id: `${fileKey}:${node.id ?? node.name ?? "node"}`,
            title: `${file.name ?? "Figma file"} — ${node.name ?? node.type ?? "node"}`,
            text: node.characters || `${node.type ?? "NODE"}: ${node.name ?? "unnamed"}`,
            url: `https://www.figma.com/design/${encodeURIComponent(fileKey)}`,
            updatedAt: file.lastModified,
            metadata: { fileKey, nodeId: node.id, nodeType: node.type, version: file.version },
          });
        }
      }
      return items.slice(0, limit);
    },
  };
}

function* walk(root?: FigmaNode): Generator<FigmaNode> {
  if (!root) return;
  yield root;
  for (const child of root.children ?? []) yield* walk(child);
}
