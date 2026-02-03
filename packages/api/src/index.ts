// API service - REST API for stream management
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "@secondlayer/shared";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import { requireAuth, rateLimit, keysRouter } from "@secondlayer/auth";
import { countApiRequests } from "./middleware/usage.ts";
import streamsRouter from "./routes/streams.ts";
import statusRouter from "./routes/status.ts";
import logsRouter from "./routes/logs.ts";
import viewsRouter, { startViewCache, stopViewCache } from "./routes/views.ts";
import authRouter from "./routes/auth.ts";
import accountsRouter from "./routes/accounts.ts";

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", requestLogger);

// Global error handler
app.onError(errorHandler);

// Key management routes (always available)
app.route("/api/keys", keysRouter);

// Auth routes (no auth required)
app.route("/api/auth", authRouter);

// Auth middleware — always mounted, DEV_MODE bypass handled inside middleware
for (const path of ["/api/streams", "/api/streams/*", "/api/views", "/api/views/*", "/api/logs", "/api/logs/*", "/api/accounts", "/api/accounts/*", "/api/auth/logout"]) {
  app.use(path, requireAuth());
  app.use(path, rateLimit());
  app.use(path, countApiRequests());
}

// Mount routes
app.route("/api/streams", streamsRouter);
app.route("/api/logs", logsRouter);
app.route("/api/views", viewsRouter);
app.route("/api/accounts", accountsRouter);
app.route("/", statusRouter);

// Start server
const PORT = parseInt(process.env.PORT || "3800");

logger.info("Starting API service", { port: PORT });

// Start view registry cache (LISTEN for view_changes)
startViewCache().catch((err) => {
  logger.warn("Failed to start view cache, views will load on-demand", { error: String(err) });
});

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down API service...");
  await stopViewCache();
  server.stop();
  logger.info("API service stopped");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
