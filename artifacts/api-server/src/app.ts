import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildX402Middleware } from "./lib/x402";

const app: Express = express();

// Replit proxy sets X-Forwarded-For — trust the first hop so rate-limit
// uses the real client IP instead of the proxy IP.
app.set("trust proxy", 1);

// Security headers — removes X-Powered-By, sets X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, HSTS, etc. CSP disabled: this is a pure JSON API, not an HTML server.
app.use(helmet({ contentSecurityPolicy: false }));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const strictLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

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

// Restrict CORS to known origins — never allow wildcard in production.
const ALLOWED_ORIGIN_PATTERNS: (string | RegExp)[] = [
  "https://arc-smart-stablecoin-logic.replit.app",
  // Exact dev domain for this Repl (REPLIT_DEV_DOMAIN is injected by the platform).
  // Falls back to broad pattern only when env var is absent (local dev).
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
    : [/\.replit\.dev$/]),
  /\.repl\.co$/,
  // localhost for local development
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests (server-to-server, curl) have no Origin header — allow.
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGIN_PATTERNS.some((p) =>
        typeof p === "string" ? p === origin : p.test(origin),
      );
      if (allowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.use("/api", limiter);
app.use("/api/escrows", strictLimiter);
app.use("/api/vesting", strictLimiter);
app.use("/api/crosschain", strictLimiter);
app.use("/api/dashboard", strictLimiter);
app.use("/api/keeper", strictLimiter);
app.use("/api/x402", strictLimiter);

// x402 payment gates — intercepts matching routes before they reach handlers.
// The in-process facilitator settles USDC payments on Arc Testnet via EIP-3009.
const x402 = buildX402Middleware();
if (x402) app.use(x402);

app.use("/api", router);

// Global error handler — catches any unhandled async rejection from route handlers.
// Must have four parameters so Express recognises it as an error handler.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
