import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

export type Scope = "mcp" | "read" | "write" | "admin";

export interface RequestContext {
  workspaceId: string;
  actorId: string;
  scopes: ReadonlySet<Scope>;
  authMethod: "api-key" | "default";
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return requestContext.run(context, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function hasScope(scope: Scope): boolean {
  const context = currentRequestContext();
  // Direct stdio usage and in-memory unit tests do not pass through HTTP auth;
  // they remain trusted local callers. HTTP requests always establish a context.
  return !context || Boolean(context.scopes.has(scope) || context.scopes.has("admin"));
}

export function defaultRequestContext(workspaceId = DEFAULT_WORKSPACE_ID): RequestContext {
  return {
    workspaceId,
    actorId: "system",
    scopes: new Set<Scope>(["mcp", "read", "write", "admin"]),
    authMethod: "default",
  };
}