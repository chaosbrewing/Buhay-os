// Serves the built web app as static assets (see wrangler.jsonc) and forwards /api/* to the API
// hosted on Vercel. The original host is passed along so Clerk resolves the right instance, and the
// visitor's address is passed so the API can rate limit per caller.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    // One canonical host: Clerk is configured for hanay.today, not www.
    if (incoming.hostname === "www.hanay.today") {
      incoming.hostname = "hanay.today";
      return Response.redirect(incoming.toString(), 301);
    }

    if (!incoming.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const ip = request.headers.get("cf-connecting-ip") || "unknown";

    // Edge limit, counted per visitor address. The API applies its own, tighter limits as well.
    if (env.API_LIMITER && incoming.pathname !== "/api/healthz") {
      const { success } = await env.API_LIMITER.limit({ key: ip });
      if (!success) {
        return new Response(
          JSON.stringify({ error: "rate_limited", message: "Too many requests. Please wait and try again." }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" },
          },
        );
      }
    }

    const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");
    headers.set("x-hanay-client-ip", ip);

    return fetch(
      new Request(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      }),
    );
  },
};
