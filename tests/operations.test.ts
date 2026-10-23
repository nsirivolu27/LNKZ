import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { drainServer, readiness, requestLogging } from "../src/lnkz/operations.js";
import { DEFAULT_WORKSPACE_ID } from "../src/lnkz/context.js";

test("request logs omit secrets in headers, URLs, bodies and unmatched paths", async () => {
  const lines: string[] = [];
  const secret = randomBytes(32).toString("hex");
  const app = express();
  app.use(requestLogging((line) => lines.push(line)));
  app.use(express.json());
  app.post("/share/:token", (_request, response) => {
    response.locals.workspaceId = DEFAULT_WORKSPACE_ID;
    response.status(201).json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${url}/share/${secret}?key=${secret}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-lnkz-context": secret, "x-request-id": secret, "content-type": "application/json" },
      body: JSON.stringify({ message: secret }),
    });
    await response.text();
    await (await fetch(`${url}/${secret}`)).text();
    assert.equal(lines.some((line) => line.includes(secret)), false);
    const logged = JSON.parse(lines[0]!);
    assert.equal(logged.path, "/share/:token");
    assert.equal(logged.method, "POST");
    assert.equal(logged.status, 201);
    assert.equal(logged.workspace, DEFAULT_WORKSPACE_ID);
    assert.equal(logged.requestId, response.headers.get("x-request-id"));
    assert.ok(logged.durationMs >= 0);
    assert.equal(JSON.parse(lines[1]!).path, "<unmatched>");
  } finally {
    await drainServer(server, async () => {}, 5_000);
  }
});

test("readiness reflects store failure and draining while liveness stays up", async () => {
  let failed = false;
  let draining = false;
  const app = express();
  app.get("/health", (_request, response) => { response.json({ ok: true }); });
  app.get("/ready", readiness({ stats: async () => {
    if (failed) throw new Error("private database detail");
    return { conversations: 0, messages: 0, providers: [], activeHandoffs: 0, events: 0 };
  } }, () => draining));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${url}/ready`)).status, 200);
    failed = true;
    const unavailable = await fetch(`${url}/ready`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false });
    assert.equal((await fetch(`${url}/health`)).status, 200);
    failed = false;
    draining = true;
    assert.equal((await fetch(`${url}/ready`)).status, 503);
  } finally {
    await drainServer(server, async () => {}, 5_000);
  }
});

test("shutdown finishes an in-flight request and awaits resource closure", async () => {
  const order: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const app = express();
  app.get("/slow", async (_request, response) => {
    entered();
    await blocked;
    order.push("request");
    response.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`);
  await started;
  const shutdown = drainServer(server, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("store");
  }, 5_000);
  assert.deepEqual(order, []);
  release();
  assert.equal((await request).status, 200);
  await shutdown;
  assert.deepEqual(order, ["request", "store"]);
});
