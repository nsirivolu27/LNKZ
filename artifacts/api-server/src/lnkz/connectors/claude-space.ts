export type ClaudeDestinationState = "connected" | "reconnect" | "unavailable" | "permission-denied";

export interface ClaudeDestinationStatus {
  provider: "claude";
  label: "Claude · My space";
  state: ClaudeDestinationState;
  detail: string;
}

/**
 * Claude.ai does not expose a managed destination connector in this workspace.
 *
 * Keep this capability separate from the model/API connectors: an Anthropic API
 * key can call a model, but it cannot deliver a conversation into a user's
 * Claude-owned space. Returning an explicit unavailable state prevents the
 * console from presenting the private-link fallback as native delivery.
 */
export function claudeDestinationStatus(): ClaudeDestinationStatus {
  return {
    provider: "claude",
    label: "Claude · My space",
    state: "unavailable",
    detail: "Direct delivery is unavailable here. Use the private handoff link instead.",
  };
}