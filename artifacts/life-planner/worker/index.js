// Serves the built web app as static assets (see wrangler.jsonc) and forwards /api/* to the API
// hosted on Vercel. The original host is passed along so Clerk resolves the right instance.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);

    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");

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
