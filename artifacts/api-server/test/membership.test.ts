import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  MembershipConflictError,
  PostgresConversationStore,
  type WorkspaceMembership,
} from "../src/lnkz/store/postgres.js";
import { runWithRequestContext } from "../src/lnkz/context.js";

const databaseUrl = process.env.DATABASE_URL;
const issuer = "https://accounts.example.test";

test("Postgres workspace membership mutations preserve access rules and audit history", {
  skip: !databaseUrl,
}, async () => {
  if (!databaseUrl) return;

  const workspaceId = randomUUID();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
  });
  let store: PostgresConversationStore | undefined;

  try {
    await pool.query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, "membership integration test"]);
    store = new PostgresConversationStore(databaseUrl, workspaceId);

    await runWithRequestContext({
      workspaceId,
      actorId: "workspace-admin",
      scopes: new Set(["admin"]),
      authMethod: "managed",
    }, async () => {
      const admin = await store!.addMembership({
        issuer,
        subject: "admin-subject",
        actorId: "admin-actor",
        scopes: ["admin", "read"],
      });
      assertMembership(admin, { subject: "admin-subject", actorId: "admin-actor", scopes: ["admin", "read"], active: true });
      await assertMembershipAudit(store!, "workspace_membership.created", admin);

      const member = await store!.addMembership({
        issuer,
        subject: "member-subject",
        actorId: "member-actor",
        scopes: ["read", "write"],
      });
      assertMembership(member, { subject: "member-subject", actorId: "member-actor", scopes: ["read", "write"], active: true });
      await assertMembershipAudit(store!, "workspace_membership.created", member);

      const listed = await store!.listMemberships();
      assert.deepEqual(listed.map(({ subject }) => subject), ["admin-subject", "member-subject"]);

      const scopeChanged = await store!.updateMembership({
        issuer,
        subject: "member-subject",
        scopes: ["read", "mcp"],
      });
      assert.ok(scopeChanged);
      assertMembership(scopeChanged, { subject: "member-subject", actorId: "member-actor", scopes: ["read", "mcp"], active: true });
      await assertMembershipAudit(store!, "workspace_membership.updated", scopeChanged, member);

      const deactivated = await store!.updateMembership({
        issuer,
        subject: "member-subject",
        active: false,
      });
      assert.ok(deactivated);
      assertMembership(deactivated, { subject: "member-subject", actorId: "member-actor", scopes: ["read", "mcp"], active: false });
      await assertMembershipAudit(store!, "workspace_membership.deactivated", deactivated, scopeChanged);

      assert.deepEqual((await store!.listMemberships()).map(({ subject }) => subject), ["admin-subject"]);
      assert.deepEqual(
        (await store!.listMemberships(true)).map(({ subject, active }) => ({ subject, active })),
        [
          { subject: "admin-subject", active: true },
          { subject: "member-subject", active: false },
        ],
      );

      const reactivated = await store!.updateMembership({
        issuer,
        subject: "member-subject",
        active: true,
        scopes: ["read", "write"],
      });
      assert.ok(reactivated);
      assertMembership(reactivated, { subject: "member-subject", actorId: "member-actor", scopes: ["read", "write"], active: true });
      await assertMembershipAudit(store!, "workspace_membership.updated", reactivated, deactivated);

      await assert.rejects(
        store!.updateMembership({ issuer, subject: "admin-subject", scopes: ["read"] }),
        (error: unknown) => {
          assert.ok(error instanceof MembershipConflictError);
          assert.equal(error.message, "Workspace must retain at least one active admin.");
          return true;
        },
      );
      await assert.rejects(
        store!.updateMembership({ issuer, subject: "admin-subject", active: false }),
        (error: unknown) => {
          assert.ok(error instanceof MembershipConflictError);
          assert.equal(error.message, "Workspace must retain at least one active admin.");
          return true;
        },
      );

      const unchangedAdmin = (await store!.listMemberships()).find(({ subject }) => subject === "admin-subject");
      assertMembership(unchangedAdmin, { subject: "admin-subject", actorId: "admin-actor", scopes: ["admin", "read"], active: true });
    });
  } finally {
    await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
    store?.close();
    await pool.end();
  }
});

function assertMembership(
  membership: WorkspaceMembership | undefined | null,
  expected: Pick<WorkspaceMembership, "subject" | "actorId" | "scopes" | "active">,
): asserts membership is WorkspaceMembership {
  assert.ok(membership);
  assert.equal(membership.issuer, issuer);
  assert.equal(membership.subject, expected.subject);
  assert.equal(membership.actorId, expected.actorId);
  assert.deepEqual(membership.scopes, expected.scopes);
  assert.equal(membership.active, expected.active);
}

async function assertMembershipAudit(
  store: PostgresConversationStore,
  kind: string,
  membership: WorkspaceMembership,
  previous?: WorkspaceMembership,
): Promise<void> {
  const events = await store.listEvents(100);
  const event = events.find((candidate) =>
    candidate.kind === kind
      && candidate.actorId === "workspace-admin"
      && (candidate.detail?.membership as { subject?: string } | undefined)?.subject === membership.subject
      && (candidate.detail?.membership as { active?: boolean } | undefined)?.active === membership.active
      && JSON.stringify((candidate.detail?.membership as { scopes?: string[] } | undefined)?.scopes) === JSON.stringify(membership.scopes)
  );
  assert.ok(event, `expected ${kind} audit event for ${membership.subject}`);
  assert.deepEqual(event.detail?.membership, membershipAuditDetail(membership));
  if (previous) assert.deepEqual(event.detail?.previous, membershipAuditDetail(previous));
}

function membershipAuditDetail(membership: WorkspaceMembership): Record<string, unknown> {
  return {
    issuer: membership.issuer,
    subject: membership.subject,
    actorId: membership.actorId,
    scopes: membership.scopes,
    active: membership.active,
  };
}