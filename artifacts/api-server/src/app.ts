import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildCorsOptions } from "./lib/corsPolicy";
import { createRateLimiter, securityHeaders } from "./lib/security";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders());
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(buildCorsOptions(process.env.CORS_ALLOWED_ORIGINS)));

// Limits are per caller and per instance; the Cloudflare Worker in front applies an edge limit too.
const isWrite = (req: { method: string }) => !["GET", "HEAD", "OPTIONS"].includes(req.method);
app.use(
  "/api",
  createRateLimiter({ name: "api", windowMs: 60_000, max: 300, skip: (req) => req.path === "/healthz" }),
);
app.use(
  "/api/planner/state",
  createRateLimiter({ name: "planner-save", windowMs: 60_000, max: 60, skip: (req) => !isWrite(req) }),
);
app.use(
  "/api/planner/calendar/google/authorize",
  createRateLimiter({ name: "oauth-start", windowMs: 60_000, max: 10 }),
);
app.use(
  "/api/planner/calendar/events",
  createRateLimiter({ name: "calendar-write", windowMs: 60_000, max: 60, skip: (req) => !isWrite(req) }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
