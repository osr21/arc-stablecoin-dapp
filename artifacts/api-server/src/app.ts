import express, { type Express } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit proxy sets X-Forwarded-For — trust the first hop so rate-limit
// uses the real client IP instead of the proxy IP.
app.set("trust proxy", 1);

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

app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.use("/api", limiter);
app.use("/api/escrows", strictLimiter);
app.use("/api/vesting", strictLimiter);
app.use("/api/crosschain", strictLimiter);

app.use("/api", router);

export default app;
