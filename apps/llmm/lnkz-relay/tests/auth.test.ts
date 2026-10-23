import assert from "node:assert/strict";
import test from "node:test";
import { isOriginAllowed, rateLimit, withLoopback } from "../src/auth.js";

test("same-origin web assets work without weakening the origin allowlist", () => {
  assert.equal(isOriginAllowed("http://127.0.0.1:3100", "127.0.0.1:3100", []), true);
  assert.equal(isOriginAllowed("https://app.example", "lnkz.example", ["https://app.example"]), true);
  assert.equal(isOriginAllowed("https://evil.example", "lnkz.example", ["https://app.example"]), false);
  assert.equal(isOriginAllowed("not a url", "lnkz.example", []), false);
});

test("the rate limiter allows a burst then refuses, and reports retry-after", () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  const request = { header: () => undefined, ip: "203.0.113.7", socket: { remoteAddress: "203.0.113.7" } } as never;

  let allowed = 0;
  let status = 0;
  let retryAfter: unknown;
  const response = {
    setHeader: (name: string, value: unknown) => { if (name === "retry-after") retryAfter = value; },
    status(code: number) { status = code; return this; },
    json: () => undefined,
  } as never;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    limiter(request, response, () => { allowed += 1; });
  }

  assert.equal(allowed, 2);
  assert.equal(status, 429);
  assert.equal(typeof retryAfter, "number");
});

test("a limiter configured with max 0 is disabled rather than blocking everything", () => {
  const limiter = rateLimit({ windowMs: 1_000, max: 0 });
  let allowed = 0;
  limiter({ header: () => undefined, ip: "198.51.100.1", socket: {} } as never, {} as never, () => { allowed += 1; });
  assert.equal(allowed, 1);
});

test("loopback hosts stay allowed so a container health check is not rejected", () => {
  const hosts = withLoopback(["lnkz.fly.dev"], 3100);
  assert.ok(hosts.includes("lnkz.fly.dev"));
  assert.ok(hosts.includes("127.0.0.1:3100"), "the in-container health check sends this Host");
  assert.ok(hosts.includes("localhost"));
  assert.equal(hosts.includes("evil.example"), false);
});

test("an empty ALLOWED_HOSTS stays empty, so the SDK default applies", () => {
  assert.deepEqual(withLoopback([], 3100), []);
});
