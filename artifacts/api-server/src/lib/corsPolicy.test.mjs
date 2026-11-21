import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import cors from "cors";
import { buildCorsOptions, parseAllowedOrigins } from "./corsPolicy.ts";

test("parseAllowedOrigins keeps exact http(s) origins and drops wildcards/invalid", () => {
  const set = parseAllowedOrigins(
    " https://app.example.com/path , *, not a url, ftp://x.test, http://localhost:3000 ",
  );
  assert.deepEqual([...set].sort(), [
    "http://localhost:3000",
    "https://app.example.com",
  ]);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
});

async function preflight(env, origin) {
  const middleware = cors(buildCorsOptions(env));
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 200;
      res.end("ok");
    }),
  );
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const headers = origin ? { Origin: origin } : {};
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
    return {
      status: res.status,
      allowOrigin: res.headers.get("access-control-allow-origin"),
      allowCreds: res.headers.get("access-control-allow-credentials"),
    };
  } finally {
    server.close();
  }
}

test("foreign origin gets no CORS headers when allowlist is empty", async () => {
  const r = await preflight(undefined, "https://evil.example");
  assert.equal(r.status, 200);
  assert.equal(r.allowOrigin, null);
  assert.equal(r.allowCreds, null);
});

test("foreign origin gets no CORS headers when not in allowlist", async () => {
  const r = await preflight("https://app.example.com", "https://evil.example");
  assert.equal(r.allowOrigin, null);
});

test("allowlisted origin is echoed with credentials", async () => {
  const r = await preflight("https://app.example.com", "https://app.example.com");
  assert.equal(r.allowOrigin, "https://app.example.com");
  assert.equal(r.allowCreds, "true");
});

test("request without Origin still works", async () => {
  const r = await preflight("https://app.example.com", undefined);
  assert.equal(r.status, 200);
  assert.equal(r.allowOrigin, null);
});
