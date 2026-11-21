import type { Request, RequestHandler } from "express";

/**
 * Baseline response headers for a JSON API. The API never serves HTML, so the policy is strict.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}

const IP_PATTERN = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * The caller to rate limit. The Cloudflare Worker in front of the API passes the visitor's address in
 * x-hanay-client-ip (every request would otherwise look like it comes from Cloudflare). Anything that
 * is not a plain address is ignored.
 */
export function clientKey(req: Pick<Request, "headers" | "ip">): string {
  const header = req.headers["x-hanay-client-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value && IP_PATTERN.test(value.trim())) return value.trim();
  return req.ip || "unknown";
}

export type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Counters are separate per name, so one route's traffic does not use another's allowance. */
  name: string;
  /** Skip counting for matching requests (for example health checks). */
  skip?: (req: Request) => boolean;
  now?: () => number;
};

const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window limiter held in memory. On serverless hosting each instance counts separately, so this
 * is a second line of defence behind the edge limit in the Cloudflare Worker, not the only one.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = (at: number) => {
    for (const [key, entry] of hits) if (entry.resetAt <= at) hits.delete(key);
  };

  return (req, res, next) => {
    if (options.skip?.(req)) return next();
    const at = now();
    if (hits.size >= MAX_TRACKED_KEYS) sweep(at);

    const key = `${options.name}:${clientKey(req)}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, options.max - entry.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((entry.resetAt - at) / 1000)));

    if (entry.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - at) / 1000)));
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Please wait and try again." });
      return;
    }
    next();
  };
}
