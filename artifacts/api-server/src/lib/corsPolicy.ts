import type { CorsOptions } from "cors";

/**
 * Parses CORS_ALLOWED_ORIGINS, a comma-separated list of exact origins
 * (for example "https://app.example.com"). Entries are normalised with
 * URL.origin; invalid entries and "*" are ignored.
 */
export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const allowed = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const value = entry.trim();
    if (!value || value === "*") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        allowed.add(url.origin);
      }
    } catch {
      // ignore malformed entries
    }
  }
  return allowed;
}

/**
 * Credentialed CORS only for explicitly allowed origins. Requests without an
 * Origin header and same-origin requests are unaffected; every other origin
 * receives no Access-Control-Allow-* headers, so browsers block the read.
 */
export function buildCorsOptions(raw: string | undefined): CorsOptions {
  const allowed = parseAllowedOrigins(raw);
  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin !== undefined && allowed.has(origin));
    },
  };
}
