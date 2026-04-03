import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "@secondlayer/auth";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
// API service - REST API for stream management
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import { countApiRequests } from "./middleware/usage.ts";
import accountsRouter from "./routes/accounts.ts";
import authRouter from "./routes/auth.ts";
import marketplaceRouter from "./routes/marketplace.ts";
import insightsRouter from "./routes/insights.ts";
import logsRouter from "./routes/logs.ts";
import nodeRouter from "./routes/node.ts";
import statusRouter from "./routes/status.ts";
import streamsRouter from "./routes/streams.ts";
import subgraphsRouter, {
	abortAllOperations,
	activeAbortControllers,
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

// Marketplace (no auth required, IP rate limited)
app.use("/api/marketplace/*", ipRateLimit(60));
app.route("/api/marketplace", marketplaceRouter);

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

// Auto-resume stale reindexes on startup
(async () => {
	try {
		const db = getDb();
		const stale = await db
			.selectFrom("subgraphs")
			.selectAll()
			.where("status", "=", "reindexing")
			.execute();

		if (stale.length === 0) return;

		logger.info("Found stale reindexing subgraphs, resuming", {
			count: stale.length,
			names: stale.map((s) => s.name),
		});

		for (const row of stale) {
			const controller = new AbortController();
			activeAbortControllers.set(row.name, controller);

			(async () => {
				try {
					const { resumeReindex } = await import("@secondlayer/subgraphs");
					const mod = await import(row.handler_path);
					const def = mod.default ?? mod;
					await resumeReindex(def, {
						schemaName: row.schema_name ?? row.name,
						signal: controller.signal,
					});
				} catch (err) {
					logger.error("Failed to resume reindex", {
						subgraph: row.name,
						error: String(err),
					});
				} finally {
					activeAbortControllers.delete(row.name);
				}
			})();
		}
	} catch (err) {
		logger.error("Failed to check for stale reindexes", {
			error: String(err),
		});
	}
})();

// Graceful shutdown — abort active reindexes, wait for drain
const SHUTDOWN_TIMEOUT = 30_000;

const shutdown = async () => {
	logger.info("Shutting down API service...");

	// Signal all active reindex/backfill operations to stop
	abortAllOperations("shutdown");

	// Wait for active operations to drain
	if (activeAbortControllers.size > 0) {
		logger.info("Waiting for active operations to drain", {
			count: activeAbortControllers.size,
		});
		const start = Date.now();
		while (activeAbortControllers.size > 0 && Date.now() - start < SHUTDOWN_TIMEOUT) {
			await new Promise((r) => setTimeout(r, 500));
		}
		if (activeAbortControllers.size > 0) {
			logger.warn("Shutdown timeout, forcing exit", {
				remaining: activeAbortControllers.size,
			});
		}
	}

	await stopSubgraphCache();
	server.stop();
	logger.info("API service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
