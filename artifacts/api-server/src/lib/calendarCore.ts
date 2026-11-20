import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class GoogleCalendarReauthorizationRequired extends Error {
  constructor() {
    super("Google Calendar access must be renewed");
    this.name = "GoogleCalendarReauthorizationRequired";
  }
}

export class GoogleCalendarTemporaryError extends Error {
  constructor() {
    super("Google Calendar is temporarily unavailable");
    this.name = "GoogleCalendarTemporaryError";
  }
}

export class GoogleCalendarAccessUpdateRequired extends Error {
  constructor() {
    super("Google Calendar permissions must be updated");
    this.name = "GoogleCalendarAccessUpdateRequired";
  }
}

export type OAuthState = {
  userId: string;
  nonce: string;
  expiresAt: number;
  returnTo?: "/planner/calendar" | "/planner/settings";
};

export function mergeReconnectedTokens(
  response: { access_token?: string; refresh_token?: string; expires_in?: number },
  previous: StoredTokens | null,
  now: number,
): StoredTokens | null {
  if (!response.access_token) return null;
  const refreshToken = response.refresh_token ?? previous?.refreshToken ?? "";
  if (!refreshToken) return null;
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: now + (response.expires_in ?? 3600) * 1000,
  };
}

export function reconnectTokenUpdate(encryptedTokens: string, connectedAt = new Date()) {
  // Calendar selections belong to the connection row and must not be included here.
  return { encryptedTokens, connectedAt };
}

export function signOAuthState(payload: OAuthState, secret: string | undefined): string {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOAuthState(
  value: string,
  secret: string | undefined,
  now = Date.now(),
): OAuthState | null {
  if (!secret) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (
      typeof state.userId !== "string" ||
      typeof state.nonce !== "string" ||
      typeof state.expiresAt !== "number" ||
      (state.returnTo !== undefined && state.returnTo !== "/planner/calendar" && state.returnTo !== "/planner/settings") ||
      state.expiresAt < now
    ) return null;
    return state;
  } catch {
    return null;
  }
}

export function matchesOAuthCallback(
  state: OAuthState | null,
  nonce: string | undefined,
  userId: string | null | undefined,
): state is OAuthState {
  return Boolean(state && nonce && state.nonce === nonce && userId === state.userId);
}

export async function completeGoogleCalendarOAuthCallback(options: {
  stateValue: string | null;
  callbackValid: boolean;
  code?: string;
  nonce?: string;
  userId?: string | null;
  secret?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string | null;
  now: number;
  fetcher: typeof fetch;
  getExistingEncryptedTokens: (userId: string) => Promise<string | null>;
  saveEncryptedTokens: (userId: string, encryptedTokens: string) => Promise<void>;
}): Promise<{ redirectTo: string; status: "connected" | "error" }> {
  const state = options.stateValue
    ? verifyOAuthState(options.stateValue, options.secret, options.now)
    : null;
  const destination = state?.returnTo === "/planner/calendar"
    ? "/planner/calendar"
    : "/planner/settings";
  const result = (status: "connected" | "error") => ({
    redirectTo: `${destination}?calendar=${status}`,
    status,
  });

  if (!matchesOAuthCallback(state, options.nonce, options.userId)) return result("error");
  if (!options.callbackValid || !options.code) return result("error");
  if (!options.clientId || !options.clientSecret || !options.redirectUri || !options.secret) {
    return result("error");
  }

  try {
    const tokenResponse = await options.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: options.code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: options.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return result("error");

    const tokensResult = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const existingEncrypted = await options.getExistingEncryptedTokens(state.userId);
    const previous = existingEncrypted
      ? decryptStoredTokens(existingEncrypted, options.secret)
      : null;
    const tokens = mergeReconnectedTokens(tokensResult, previous, options.now);
    if (!tokens) return result("error");

    await options.saveEncryptedTokens(
      state.userId,
      encryptStoredTokens(tokens, options.secret),
    );
    return result("connected");
  } catch {
    return result("error");
  }
}

function tokenEncryptionKey(secret: string | undefined): Buffer {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret)
    .update("daybook-google-calendar-token-encryption-v1")
    .digest();
}

export function encryptStoredTokens(tokens: StoredTokens, secret: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

export function decryptStoredTokens(encrypted: string, secret: string | undefined): StoredTokens {
  const stored = JSON.parse(encrypted) as {
    version: number;
    iv: string;
    tag: string;
    ciphertext: string;
  };
  if (stored.version !== 1) throw new Error("Unsupported encrypted Google token format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(secret),
    Buffer.from(stored.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as StoredTokens;
}

export async function refreshStoredTokens(
  tokens: StoredTokens,
  options: {
    clientId?: string;
    clientSecret?: string;
    now: number;
    fetcher: typeof fetch;
  },
): Promise<StoredTokens | null> {
  if (tokens.expiresAt > options.now + 60_000) return tokens;
  if (!tokens.refreshToken) throw new GoogleCalendarReauthorizationRequired();
  if (!options.clientId || !options.clientSecret) throw new GoogleCalendarTemporaryError();
  let response: Response;
  try {
    response = await options.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GoogleCalendarTemporaryError();
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    if (result?.error === "invalid_grant") {
      throw new GoogleCalendarReauthorizationRequired();
    }
    throw new GoogleCalendarTemporaryError();
  }
  let refreshed: { access_token?: string; expires_in?: number };
  try {
    refreshed = (await response.json()) as { access_token?: string; expires_in?: number };
  } catch {
    throw new GoogleCalendarTemporaryError();
  }
  if (!refreshed.access_token) throw new GoogleCalendarTemporaryError();
  return {
    ...tokens,
    accessToken: refreshed.access_token,
    expiresAt: options.now + (refreshed.expires_in ?? 3600) * 1000,
  };
}

export async function revokeGoogleTokenBestEffort(
  token: string,
  fetcher: typeof fetch,
): Promise<void> {
  try {
    await fetcher("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Local credentials are still removed if Google's revocation endpoint is unavailable.
  }
}

export async function disconnectCalendarConnection(
  revoke: () => Promise<void>,
  removeLocal: () => Promise<void>,
): Promise<void> {
  try {
    await revoke();
  } catch {
    // Local credentials must still be removed if revocation cannot complete.
  }
  await removeLocal();
}

export async function conditionalGoogleWrite<ResponseType extends { status: number }, EventType>(
  write: () => Promise<ResponseType>,
  readCurrent: () => Promise<EventType | null>,
): Promise<{ kind: "response"; response: ResponseType } | { kind: "conflict"; current: EventType | null }> {
  const response = await write();
  if (response.status !== 412) return { kind: "response", response };
  return { kind: "conflict", current: await readCurrent() };
}

export function toGoogleDateTime(value: {
  dateTime: Date | null;
  date: Date | null;
  timeZone: string | null;
}): Record<string, string> {
  if (value.dateTime && !value.date) {
    return {
      dateTime: value.dateTime.toISOString(),
      ...(value.timeZone ? { timeZone: value.timeZone } : {}),
    };
  }
  if (value.date && !value.dateTime) {
    return { date: value.date.toISOString().slice(0, 10) };
  }
  throw new Error("An event start and end must each be either a timed value or an all-day date");
}

export function eventWriteBody(data: {
  title: string;
  description?: string | null;
  location?: string | null;
  start: { dateTime: Date | null; date: Date | null; timeZone: string | null };
  end: { dateTime: Date | null; date: Date | null; timeZone: string | null };
}) {
  const start = toGoogleDateTime(data.start);
  const end = toGoogleDateTime(data.end);
  if (start.dateTime && end.dateTime && new Date(start.dateTime) >= new Date(end.dateTime)) {
    throw new Error("Event end must be after its start");
  }
  if (start.date && end.date && start.date >= end.date) {
    throw new Error("Event end date must be after its start date");
  }
  return {
    summary: data.title,
    description: data.description ?? "",
    location: data.location ?? "",
    start,
    end,
  };
}
