import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "@secondlayer/auth";
import { logger } from "@secondlayer/shared";
// API service - REST API for stream management
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import { countApiRequests } from "./middleware/usage.ts";
import accountsRouter from "./routes/accounts.ts";
import authRouter from "./routes/auth.ts";
import insightsRouter from "./routes/insights.ts";
import logsRouter from "./routes/logs.ts";
import nodeRouter from "./routes/node.ts";
import statusRouter from "./routes/status.ts";
import streamsRouter from "./routes/streams.ts";
import subgraphsRouter, {
	startSubgraphCache,
	stopSubgraphCache,
} from "./routes/subgraphs.ts";
import waitlistRouter from "./routes/waitlist.ts";

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", requestLogger);

// Global error handler
app.onError(errorHandler);

// Key management routes (always available)
app.route("/api/keys", keysRouter);

// Auth routes (no auth required, IP rate limited)
app.use("/api/auth/*", ipRateLimit(10));
app.route("/api/auth", authRouter);

// Waitlist (no auth required)
app.route("/api/waitlist", waitlistRouter);

// Auth middleware — always mounted, DEV_MODE bypass handled inside middleware
for (const path of [
	"/status",
	"/api/streams",
	"/api/streams/*",
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/logs",
	"/api/logs/*",
	"/api/accounts",
	"/api/accounts/*",
	"/api/insights",
	"/api/insights/*",
	"/api/node",
	"/api/node/*",
	"/api/auth/logout",
]) {
	app.use(path, requireAuth());
	app.use(path, rateLimit());
	app.use(path, countApiRequests());
}

// Mount routes
app.route("/api/streams", streamsRouter);
app.route("/api/logs", logsRouter);
app.route("/api/subgraphs", subgraphsRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/insights", insightsRouter);
app.route("/api/node", nodeRouter);
app.route("/", statusRouter);

// Start server
const PORT = Number.parseInt(process.env.PORT || "3800");

logger.info("Starting API service", { port: PORT });

// Start subgraph registry cache (LISTEN for subgraph_changes)
startSubgraphCache().catch((err) => {
	logger.warn("Failed to start subgraph cache, subgraphs will load on-demand", {
		error: String(err),
	});
});

const server = Bun.serve({
	port: PORT,
	fetch: app.fetch,
});

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down API service...");
	await stopSubgraphCache();
	server.stop();
	logger.info("API service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
