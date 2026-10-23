import { createDocumentsConnector } from "./documents.js";
import { createFantasyConnector } from "./fantasy.js";
import { createFigmaConnector } from "./figma.js";
import { createJiraConnector } from "./jira.js";
import { createSlackConnector } from "./slack.js";
import type { Connector, ConnectorId, ConnectorStatus } from "../types.js";

const EXTERNAL_CONNECTORS: Array<{ id: ConnectorId; label: string; create: () => Connector | null }> = [
  { id: "slack", label: "Slack", create: () => createSlackConnector() },
  { id: "jira", label: "Jira Cloud", create: () => createJiraConnector() },
  { id: "figma", label: "Figma", create: () => createFigmaConnector() },
  { id: "documents", label: "Documentation feeds", create: () => createDocumentsConnector() },
  { id: "fantasy", label: "Fantasy Copilot", create: () => createFantasyConnector() },
];

export function configuredExternalConnectors(): Connector[] {
  return EXTERNAL_CONNECTORS
    .map((entry) => entry.create())
    .filter((connector): connector is Connector => connector != null);
}

export function connectorStatuses(core?: Connector): ConnectorStatus[] {
  const configured = new Map(configuredExternalConnectors().map((connector) => [connector.id, connector]));
  const external = EXTERNAL_CONNECTORS.map((entry) => configured.get(entry.id)?.status() ?? {
    id: entry.id,
    label: entry.label,
    configured: false,
    detail: "Required environment variables are not configured.",
  });
  return core ? [core.status(), ...external] : external;
}
