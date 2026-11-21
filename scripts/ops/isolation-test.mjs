// Two-account isolation test against a locally running API, a Neon *development* branch and two
// throwaway users on the Clerk development instance. Does not touch production data or accounts.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)).split("\\").join("/").replace(/\/+$/, "");
const require = createRequire(`${ROOT}/lib/db/package.json`);
const pg = require("pg");

const parseEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
  );
const dev = parseEnv(`${ROOT}/artifacts/life-planner/.env.development.local`);
if (!dev.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw new Error("expected a development Clerk secret key");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

const neon = (...args) => execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["-y", "neon@latest", ...args], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
const dbUrl = neon("connection-string", "development").trim().split(/\s+/).find((s) => s.startsWith("postgres"));

async function clerk(path, method = "GET", body) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${dev.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const stamp = Date.now().toString(36);
const users = [];
let server;
try {
  // Make sure the development branch has the tables.
  const pool = new pg.Pool({ connectionString: dbUrl });
  const t = await pool.query("select table_name from information_schema.tables where table_schema='public'");
  const have = t.rows.map((r) => r.table_name);
  if (!have.includes("planner_state")) throw new Error("development branch has no planner_state table: " + have.join(","));
  await pool.end();

  // Two throwaway users and a session token for each.
  const tokens = {};
  for (const who of ["a", "b"]) {
    const u = await clerk("/users", "POST", {
      username: `isolation_${who}_${stamp}`,
      email_address: [`isolation-${who}-${stamp}+clerk_test@example.com`],
      password: `Iso-${stamp}-${Math.random().toString(36).slice(2)}-Xz9!`,
      skip_password_checks: true,
    });
    users.push(u.id);
    const s = await clerk("/sessions", "POST", { user_id: u.id });
    const tk = await clerk(`/sessions/${s.id}/tokens`, "POST", {});
    tokens[who] = tk.jwt;
  }

  // Run the API locally.
  const env = {
    ...process.env,
    PORT: "8083",
    NODE_ENV: "development",
    DATABASE_URL: dbUrl,
    CLERK_PUBLISHABLE_KEY: dev.CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: dev.CLERK_SECRET_KEY,
    SESSION_SECRET: "isolation-test-secret-" + stamp,
    CORS_ALLOWED_ORIGINS: "http://localhost:5190",
  };
  server = spawn("node", ["--enable-source-maps", `${ROOT}/artifacts/api-server/dist/index.mjs`], { env, stdio: "ignore" });
  const base = "http://127.0.0.1:8083/api";
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const call = (who, path, method = "GET", body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const payload = (tag) => ({ cryptoVersion: 1, kdf: "PBKDF2-SHA256", salt: "c2FsdHNhbHRzYWx0c2FsdHNhbHRzYWx0c2FsdA==", iv: "aXZpdml2aXZpdml2aXZpdg==", ciphertext: Buffer.from("secret-" + tag).toString("base64") });

  check("no token -> 401", (await call(null, "/planner/state")).status === 401);
  check("garbage token -> 401", (await fetch(`${base}/planner/state`, { headers: { Authorization: "Bearer not.a.jwt" } })).status === 401);

  const a0 = await (await call("a", "/planner/state")).json();
  const b0 = await (await call("b", "/planner/state")).json();
  check("fresh users start empty", a0.exists === false && b0.exists === false);

  const aSave = await call("a", "/planner/state", "PUT", { expectedRevision: 0, payload: payload("A") });
  check("A can save", aSave.status === 200, `status ${aSave.status}`);

  const bSees = await (await call("b", "/planner/state")).json();
  check("B cannot see A's planner", bSees.exists === false && bSees.payload === null);

  const bSave = await call("b", "/planner/state", "PUT", { expectedRevision: 0, payload: payload("B") });
  check("B saves independently (revision 0 -> 1, not a conflict)", bSave.status === 200, `status ${bSave.status}`);

  const aAfter = await (await call("a", "/planner/state")).json();
  check("A's data is unchanged by B's save", aAfter.exists && aAfter.payload.ciphertext === payload("A").ciphertext);
  const bAfter = await (await call("b", "/planner/state")).json();
  check("B reads only B's data", bAfter.exists && bAfter.payload.ciphertext === payload("B").ciphertext);

  const aVers = await (await call("a", "/planner/versions")).json();
  const bVers = await (await call("b", "/planner/versions")).json();
  check("each account lists only its own versions", JSON.stringify(aVers).length > 2 && !JSON.stringify(bVers).includes(payload("A").ciphertext) && !JSON.stringify(aVers).includes(payload("B").ciphertext));

  const bGetsA = await call("b", "/planner/versions/1");
  const bGetsAJson = await bGetsA.json().catch(() => ({}));
  check("B's version 1 is B's own, never A's", !JSON.stringify(bGetsAJson).includes(payload("A").ciphertext));

  const forge = await call("b", "/planner/state", "PUT", { expectedRevision: 1, payload: payload("B2"), userId: "someone-else" });
  const aAfterForge = await (await call("a", "/planner/state")).json();
  check("a forged userId in the body does not reach another account", aAfterForge.payload.ciphertext === payload("A").ciphertext, `status ${forge.status}`);

  const stale = await call("a", "/planner/state", "PUT", { expectedRevision: 0, payload: payload("A-stale") });
  check("stale revision is refused with 409", stale.status === 409, `status ${stale.status}`);

  const unauth = await call(null, "/planner/versions");
  check("versions need a login", unauth.status === 401);
} catch (e) {
  console.log("TEST ERROR: " + String(e.message).slice(0, 300));
  results.push({ name: "harness", pass: false });
} finally {
  if (server) server.kill();
  // Clean up: remove their rows and the throwaway users.
  try {
    const pool = new pg.Pool({ connectionString: dbUrl });
    for (const id of users) {
      await pool.query("delete from planner_versions where user_id=$1", [id]);
      await pool.query("delete from planner_state where user_id=$1", [id]);
    }
    await pool.end();
  } catch {}
  for (const id of users) { try { await clerk(`/users/${id}`, "DELETE"); } catch {} }
  console.log(`cleanup: ${users.length} test users removed`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed === 0 ? `RESULT: PASS (${results.length} checks)` : `RESULT: FAIL (${failed} of ${results.length})`);
