export type Role = "owner" | "member" | "viewer";
export type Capability =
  | "conversation:read"
  | "conversation:write"
  | "conversation:delete"
  | "handoff:create"
  | "handoff:revoke"
  | "audit:read"
  | "workspace:manage"
  | "token:manage";

/** The authorization policy is centralized so REST and MCP cannot drift. */
export const CAPABILITIES: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  owner: new Set<Capability>([
    "conversation:read", "conversation:write", "conversation:delete",
    "handoff:create", "handoff:revoke", "audit:read", "workspace:manage", "token:manage",
  ]),
  member: new Set<Capability>([
    "conversation:read", "conversation:write", "handoff:create", "handoff:revoke",
  ]),
  viewer: new Set<Capability>(["conversation:read"]),
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].has(capability);
}
