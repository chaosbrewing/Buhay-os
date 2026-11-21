import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { clientKey, createRateLimiter, securityHeaders } from "./security.ts";

async function withApp(configure, run) {
  const app = express();
  app.set("trust proxy", false);
  configure(app);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("security headers are set on every response", async () => {
  await withApp(
    (app) => {
      app.use(securityHeaders());
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    },
    async (base) => {
      const res = await fetch(`${base}/api/x`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(res.headers.get("strict-transport-security"), /max-age=31536000/);
      assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
      assert.equal(res.headers.get("cache-control"), "no-store");
    },
  );
});

test("the limiter allows up to max requests, then answers 429 with Retry-After", async () => {
  await withApp(
    (app) => {
      app.use(createRateLimiter({ name: "t", windowMs: 60_000, max: 3 }));
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    },
    async (base) => {
      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await fetch(`${base}/api/x`)).status);
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
      const blocked = await fetch(`${base}/api/x`);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
      assert.equal(blocked.headers.get("ratelimit-remaining"), "0");
      assert.equal((await blocked.json()).error, "rate_limited");
    },
  );
});

test("callers are counted separately by the address the Worker passes", async () => {
  await withApp(
    (app) => {
      app.use(createRateLimiter({ name: "t", windowMs: 60_000, max: 1 }));
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    },
    async (base) => {
      const call = (ip) => fetch(`${base}/api/x`, { headers: { "x-hanay-client-ip": ip } }).then((r) => r.status);
      assert.equal(await call("203.0.113.1"), 200);
      assert.equal(await call("203.0.113.1"), 429);
      assert.equal(await call("203.0.113.2"), 200);
    },
  );
});

test("the allowance resets when the window passes", async () => {
  let clock = 1_000;
  await withApp(
    (app) => {
      app.use(createRateLimiter({ name: "t", windowMs: 10_000, max: 1, now: () => clock }));
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/x`)).status, 200);
      assert.equal((await fetch(`${base}/api/x`)).status, 429);
      clock += 10_001;
      assert.equal((await fetch(`${base}/api/x`)).status, 200);
    },
  );
});

test("skip lets matching requests through without counting", async () => {
  await withApp(
    (app) => {
      app.use(createRateLimiter({ name: "t", windowMs: 60_000, max: 1, skip: (req) => req.path === "/api/healthz" }));
      app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    },
    async (base) => {
      for (let i = 0; i < 4; i += 1) assert.equal((await fetch(`${base}/api/healthz`)).status, 200);
      assert.equal((await fetch(`${base}/api/x`)).status, 200);
      assert.equal((await fetch(`${base}/api/x`)).status, 429);
    },
  );
});

test("clientKey ignores values that are not a plain address", () => {
  assert.equal(clientKey({ headers: { "x-hanay-client-ip": "198.51.100.7" }, ip: "10.0.0.1" }), "198.51.100.7");
  assert.equal(clientKey({ headers: { "x-hanay-client-ip": "2001:db8::1" }, ip: "10.0.0.1" }), "2001:db8::1");
  assert.equal(clientKey({ headers: { "x-hanay-client-ip": "<script>alert(1)</script>" }, ip: "10.0.0.1" }), "10.0.0.1");
  assert.equal(clientKey({ headers: {}, ip: undefined }), "unknown");
});
