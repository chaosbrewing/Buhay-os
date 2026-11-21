// Backup / restore drill on a throwaway Neon branch. Never touches the production branch's data.
import { execSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { createRequire } from "node:module";

import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)).split("\\").join("/").replace(/\/+$/, "");
const require = createRequire(`${ROOT}/lib/db/package.json`);
const pg = require("pg");

const BRANCH = "drill-restore-test";
const neon = (args) =>
  execSync(`npx -y neon@latest ${args}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const log = (m) => console.log(m);
const b64 = (u8) => Buffer.from(u8).toString("base64");

async function encrypt(plain, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { cryptoVersion: 1, kdf: "PBKDF2-SHA256", salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) };
}
async function decrypt(p, pass) {
  const salt = Buffer.from(p.salt, "base64");
  const iv = Buffer.from(p.iv, "base64");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, Buffer.from(p.ciphertext, "base64"));
  return new TextDecoder().decode(pt);
}
async function withDb(fn) {
  const url = neon(`connection-string ${BRANCH}`).trim().split(/\s+/).find((s) => s.startsWith("postgres"));
  const pool = new pg.Pool({ connectionString: url });
  try { return await fn(pool); } finally { await pool.end(); }
}

const PASS = "drill passphrase (test only)";
const PLAIN = JSON.stringify({ note: "restore drill", tasks: ["a", "b", "c"] });
let ok = false;
try {
  neon(`branches delete ${BRANCH}`); neon("branches delete drill-before-restore");
} catch {}
try {
  log("1. create branch from production");
  neon(`branches create --name ${BRANCH}`);

  log("2. write an encrypted planner_state row");
  const payload = await encrypt(PLAIN, PASS);
  await withDb((db) =>
    db.query("insert into planner_state (user_id, revision, payload) values ($1,$2,$3)", ["drill-user", 1, JSON.stringify(payload)]),
  );
  const t = await withDb(async (db) => (await db.query("select now() as t")).rows[0].t);
  const checkpoint = new Date(t).toISOString();
  log(`   checkpoint ${checkpoint}`);
  await new Promise((r) => setTimeout(r, 4000));

  log("3. simulate data loss (delete the row)");
  await withDb((db) => db.query("delete from planner_state where user_id = 'drill-user'"));
  const gone = await withDb(async (db) => (await db.query("select count(*)::int c from planner_state where user_id='drill-user'")).rows[0].c);
  log(`   rows after delete: ${gone}`);

  log("4. restore the branch to the checkpoint");
  neon(`branches restore ${BRANCH} ${BRANCH}@${checkpoint} --preserve-under-name drill-before-restore`);

  log("5. verify the row is back and decrypts for its owner");
  const row = await withDb(async (db) => (await db.query("select revision, payload from planner_state where user_id='drill-user'")).rows[0]);
  if (!row) throw new Error("row missing after restore");
  const plain = await decrypt(row.payload, PASS);
  const same = plain === PLAIN;
  const identical = ["cryptoVersion","kdf","salt","iv","ciphertext"].every((k) => row.payload[k] === payload[k]);
  log(`   revision ${row.revision}; decrypts to the original: ${same}; ciphertext byte-identical: ${identical}`);
  let wrongPass = "n/a";
  try { await decrypt(row.payload, "wrong"); wrongPass = "DECRYPTED (bad)"; } catch { wrongPass = "refused (good)"; }
  log(`   wrong passphrase: ${wrongPass}`);
  ok = same && identical;
} catch (e) {
  log("DRILL ERROR: " + String(e.message).split("\n").slice(0, 3).join(" | "));
} finally {
  try { neon(`branches delete ${BRANCH}`); try { neon("branches delete drill-before-restore"); } catch {} log("6. cleanup: drill branches deleted"); } catch (e) { log("cleanup failed: " + String(e.message).slice(0, 120)); }
}
log(ok ? "RESULT: PASS" : "RESULT: FAIL");
