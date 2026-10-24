import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionalGoogleWrite,
  completeGoogleCalendarOAuthCallback,
  disconnectCalendarConnection,
  decryptStoredTokens,
  encryptStoredTokens,
  eventWriteBody,
  GoogleCalendarReauthorizationRequired,
  GoogleCalendarTemporaryError,
  matchesOAuthCallback,
  mergeReconnectedTokens,
  reconnectTokenUpdate,
  refreshStoredTokens,
  revokeGoogleTokenBestEffort,
  signOAuthState,
  verifyOAuthState,
} from "./calendarCore.ts";

const secret = "test-only-session-secret";
const timestamp = Date.UTC(2026, 9, 12, 12);

test("OAuth state is signed, expires, and remains bound to its user and browser nonce", () => {
  const state = {
    userId: "user-1",
    nonce: "nonce-1",
    expiresAt: timestamp + 60_000,
    returnTo: "/planner/calendar",
  };
  const signed = signOAuthState(state, secret);

  assert.deepEqual(verifyOAuthState(signed, secret, timestamp), state);
  assert.equal(matchesOAuthCallback(verifyOAuthState(signed, secret, timestamp), "nonce-1", "user-1"), true);
  assert.equal(matchesOAuthCallback(verifyOAuthState(signed, secret, timestamp), "nonce-1", "user-2"), false);
  assert.equal(matchesOAuthCallback(verifyOAuthState(signed, secret, timestamp), "other-nonce", "user-1"), false);
  assert.equal(verifyOAuthState(signed, "different-secret", timestamp), null);
  assert.equal(verifyOAuthState(`${signed}x`, secret, timestamp), null);
  assert.equal(verifyOAuthState(signOAuthState({ ...state, expiresAt: timestamp - 1 }, secret), secret, timestamp), null);
  assert.equal(verifyOAuthState(signOAuthState({ ...state, returnTo: "/outside" }, secret), secret, timestamp), null);
});

test("OAuth reconnection keeps the previous refresh token when Google omits a replacement", () => {
  const previous = { accessToken: "old-access", refreshToken: "saved-refresh", expiresAt: timestamp - 1 };
  assert.deepEqual(mergeReconnectedTokens({
    access_token: "new-access",
    expires_in: 1800,
  }, previous, timestamp), {
    accessToken: "new-access",
    refreshToken: "saved-refresh",
    expiresAt: timestamp + 1_800_000,
  });
  assert.deepEqual(mergeReconnectedTokens({
    access_token: "new-access",
    refresh_token: "new-refresh",
  }, null, timestamp), {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: timestamp + 3_600_000,
  });
  assert.equal(mergeReconnectedTokens({ access_token: "new-access" }, null, timestamp), null);
});

test("OAuth reconnection updates credentials without replacing saved calendar selections", () => {
  const connection = {
    encryptedTokens: "old-encrypted-tokens",
    selectedCalendarIds: ["work", "family"],
    connectedAt: new Date(timestamp - 60_000),
  };
  Object.assign(connection, reconnectTokenUpdate("new-encrypted-tokens", new Date(timestamp)));
  assert.deepEqual(connection, {
    encryptedTokens: "new-encrypted-tokens",
    selectedCalendarIds: ["work", "family"],
    connectedAt: new Date(timestamp),
  });
});

test("OAuth callback reconnects in place and keeps saved calendar IDs", async () => {
  const now = timestamp;
  const state = signOAuthState({
    userId: "user-1",
    nonce: "nonce-1",
    expiresAt: now + 60_000,
    returnTo: "/planner/calendar",
  }, secret);
  const originalSelection = ["work", "family"];
  const connection = {
    encryptedTokens: encryptStoredTokens({
      accessToken: "old-access",
      refreshToken: "saved-refresh",
      expiresAt: now - 1,
    }, secret),
    selectedCalendarIds: originalSelection,
  };
  let exchangedCode;
  let savedSelection;

  const callback = await completeGoogleCalendarOAuthCallback({
    stateValue: state,
    callbackValid: true,
    code: "authorization-code",
    nonce: "nonce-1",
    userId: "user-1",
    secret,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://daybook.example/api/planner/calendar/google/callback",
    now,
    fetcher: async (_url, init) => {
      exchangedCode = new URLSearchParams(init.body).get("code");
      return new Response(JSON.stringify({ access_token: "new-access", expires_in: 1800 }), { status: 200 });
    },
    getExistingEncryptedTokens: async () => connection.encryptedTokens,
    saveEncryptedTokens: async (_userId, encryptedTokens) => {
      const update = reconnectTokenUpdate(encryptedTokens, new Date(now));
      Object.assign(connection, update);
      savedSelection = connection.selectedCalendarIds;
    },
  });

  assert.equal(exchangedCode, "authorization-code");
  assert.deepEqual(callback, { redirectTo: "/planner/calendar?calendar=connected", status: "connected" });
  assert.deepEqual(decryptStoredTokens(connection.encryptedTokens, secret), {
    accessToken: "new-access",
    refreshToken: "saved-refresh",
    expiresAt: now + 1_800_000,
  });
  assert.deepEqual(savedSelection, originalSelection);
  assert.deepEqual(connection.selectedCalendarIds, originalSelection);
});

test("failed OAuth callback redirects to draft recovery without changing saved calendar IDs", async () => {
  const now = timestamp;
  const state = signOAuthState({
    userId: "user-1",
    nonce: "nonce-1",
    expiresAt: now + 60_000,
    returnTo: "/planner/calendar",
  }, secret);
  const originalSelection = ["work"];
  const connection = {
    encryptedTokens: encryptStoredTokens({
      accessToken: "saved-access",
      refreshToken: "saved-refresh",
      expiresAt: now + 3_600_000,
    }, secret),
    selectedCalendarIds: originalSelection,
  };
  let writes = 0;
  const callback = await completeGoogleCalendarOAuthCallback({
    stateValue: state,
    callbackValid: true,
    code: "authorization-code",
    nonce: "nonce-1",
    userId: "user-1",
    secret,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://daybook.example/api/planner/calendar/google/callback",
    now,
    fetcher: async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 400 }),
    getExistingEncryptedTokens: async () => connection.encryptedTokens,
    saveEncryptedTokens: async (_userId, encryptedTokens) => {
      writes += 1;
      Object.assign(connection, reconnectTokenUpdate(encryptedTokens, new Date(now)));
    },
  });

  assert.deepEqual(callback, { redirectTo: "/planner/calendar?calendar=error", status: "error" });
  assert.equal(writes, 0);
  assert.deepEqual(connection.selectedCalendarIds, originalSelection);
});

test("an invalid OAuth state uses the safe settings recovery path", async () => {
  let tokenRequests = 0;
  const callback = await completeGoogleCalendarOAuthCallback({
    stateValue: "invalid-state",
    callbackValid: true,
    code: "authorization-code",
    nonce: "nonce-1",
    userId: "user-1",
    secret,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://daybook.example/api/planner/calendar/google/callback",
    now: timestamp,
    fetcher: async () => {
      tokenRequests += 1;
      return new Response("{}", { status: 200 });
    },
    getExistingEncryptedTokens: async () => null,
    saveEncryptedTokens: async () => {},
  });

  assert.deepEqual(callback, { redirectTo: "/planner/settings?calendar=error", status: "error" });
  assert.equal(tokenRequests, 0);
});

test("Google tokens are encrypted, authenticated, and readable only with the same secret", () => {
  const tokens = { accessToken: "access-secret-value", refreshToken: "refresh-secret-value", expiresAt: timestamp };
  const encrypted = encryptStoredTokens(tokens, secret);
  assert.equal(encrypted.includes(tokens.accessToken), false);
  assert.equal(encrypted.includes(tokens.refreshToken), false);
  assert.deepEqual(decryptStoredTokens(encrypted, secret), tokens);
  assert.throws(() => decryptStoredTokens(encrypted, "another-secret"));

  const parsed = JSON.parse(encrypted);
  parsed.ciphertext = `${parsed.ciphertext.slice(0, -1)}${parsed.ciphertext.endsWith("a") ? "b" : "a"}`;
  assert.throws(() => decryptStoredTokens(JSON.stringify(parsed), secret));
});

test("expired access tokens refresh once while retaining the refresh token", async () => {
  const oldTokens = { accessToken: "old-access", refreshToken: "long-lived-refresh", expiresAt: timestamp - 1 };
  let calls = 0;
  const refreshed = await refreshStoredTokens(oldTokens, {
    clientId: "client-id",
    clientSecret: "client-secret",
    now: timestamp,
    fetcher: async (_url, init) => {
      calls += 1;
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("refresh_token"), oldTokens.refreshToken);
      assert.equal(form.get("grant_type"), "refresh_token");
      return new Response(JSON.stringify({ access_token: "new-access", expires_in: 1800 }), { status: 200 });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(refreshed, {
    accessToken: "new-access",
    refreshToken: oldTokens.refreshToken,
    expiresAt: timestamp + 1_800_000,
  });
});

test("token refresh distinguishes missing setup and temporary Google failures", async () => {
  let calls = 0;
  const tokens = { accessToken: "old", refreshToken: "refresh", expiresAt: timestamp - 1 };
  await assert.rejects(refreshStoredTokens(tokens, {
    now: timestamp,
    fetcher: async () => { calls += 1; return new Response(null, { status: 200 }); },
  }), GoogleCalendarTemporaryError);
  assert.equal(calls, 0);

  await assert.rejects(refreshStoredTokens(tokens, {
    clientId: "client",
    clientSecret: "secret",
    now: timestamp,
    fetcher: async () => { calls += 1; return new Response(null, { status: 503 }); },
  }), GoogleCalendarTemporaryError);
  assert.equal(calls, 1);
});

test("a revoked Google refresh token is a terminal authorization failure", async () => {
  const tokens = { accessToken: "old", refreshToken: "revoked", expiresAt: timestamp - 1 };
  await assert.rejects(refreshStoredTokens(tokens, {
    clientId: "client",
    clientSecret: "secret",
    now: timestamp,
    fetcher: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  }), GoogleCalendarReauthorizationRequired);
});

test("disconnect always removes the local connection when Google revocation fails", async () => {
  let removed = 0;
  await disconnectCalendarConnection(
    () => revokeGoogleTokenBestEffort("refresh", async () => {
      throw new Error("Google unavailable");
    }),
    async () => { removed += 1; },
  );
  assert.equal(removed, 1);

  await disconnectCalendarConnection(
    async () => { throw new Error("Invalid stored token"); },
    async () => { removed += 1; },
  );
  assert.equal(removed, 2);
});

test("a stale ETag returns the current event or a removed-event conflict without replaying the write", async () => {
  const current = { id: "event-1", etag: '"fresh"' };
  let writes = 0;
  let reads = 0;
  const result = await conditionalGoogleWrite(
    async () => { writes += 1; return { status: 412 }; },
    async () => { reads += 1; return current; },
  );
  assert.deepEqual(result, { kind: "conflict", current });
  assert.equal(writes, 1);
  assert.equal(reads, 1);

  const removed = await conditionalGoogleWrite(
    async () => { writes += 1; return { status: 412 }; },
    async () => { reads += 1; return null; },
  );
  assert.deepEqual(removed, { kind: "conflict", current: null });
  assert.equal(writes, 2);
  assert.equal(reads, 2);
});

test("non-conflict writes are returned directly and are not followed by a fetch or retry", async () => {
  let writes = 0;
  let reads = 0;
  const response = { status: 200, body: { id: "event-1" } };
  const result = await conditionalGoogleWrite(
    async () => { writes += 1; return response; },
    async () => { reads += 1; return null; },
  );
  assert.deepEqual(result, { kind: "response", response });
  assert.equal(writes, 1);
  assert.equal(reads, 0);
});

test("server event writes preserve all-day date-only values and exclusive end dates", () => {
  const body = eventWriteBody({
    title: "Trip",
    start: { date: new Date("2026-03-08T00:00:00.000Z"), dateTime: null, timeZone: null },
    end: { date: new Date("2026-03-10T00:00:00.000Z"), dateTime: null, timeZone: null },
  });
  assert.deepEqual(body.start, { date: "2026-03-08" });
  assert.deepEqual(body.end, { date: "2026-03-10" });
  assert.equal("dateTime" in body.start, false);
  assert.throws(() => eventWriteBody({
    title: "Invalid all-day event",
    start: { date: new Date("2026-03-10T00:00:00.000Z"), dateTime: null, timeZone: null },
    end: { date: new Date("2026-03-10T00:00:00.000Z"), dateTime: null, timeZone: null },
  }), /after its start date/);
});
