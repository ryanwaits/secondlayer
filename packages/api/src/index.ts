import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "@secondlayer/auth";
import { logger } from "@secondlayer/shared";
import { closeDb, getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAdmin } from "./middleware/admin.ts";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import { countApiRequests } from "./middleware/usage.ts";
import accountsRouter from "./routes/accounts.ts";
import adminRouter from "./routes/admin.ts";
import authRouter from "./routes/auth.ts";
import chatSessionsRouter from "./routes/chat-sessions.ts";
import insightsRouter from "./routes/insights.ts";
import marketplaceRouter from "./routes/marketplace.ts";
import nodeRouter from "./routes/node.ts";
import projectsRouter from "./routes/projects.ts";
import { secretsRouter } from "./routes/secrets.ts";
import statusRouter from "./routes/status.ts";
import subgraphsRouter, {
	abortAllOperations,
	activeAbortControllers,
	startSubgraphCache,
	stopSubgraphCache,
} from "./routes/subgraphs.ts";
import waitlistRouter from "./routes/waitlist.ts";
import workflowsRouter from "./routes/workflows.ts";

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

// Admin routes — auth + admin guard
app.use("/api/admin/*", requireAuth());
app.use("/api/admin/*", requireAdmin());
app.route("/api/admin", adminRouter);

// Auth middleware — always mounted, DEV_MODE bypass handled inside middleware
for (const path of [
	"/status",
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/accounts",
	"/api/accounts/*",
	"/api/insights",
	"/api/insights/*",
	"/api/node",
	"/api/node/*",
	"/api/projects",
	"/api/projects/*",
	"/api/chat-sessions",
	"/api/chat-sessions/*",
	"/api/workflows",
	"/api/workflows/*",
	"/api/secrets",
	"/api/secrets/*",
	"/api/auth/logout",
]) {
	app.use(path, requireAuth());
	app.use(path, rateLimit());
	app.use(path, countApiRequests());
}

app.route("/api/subgraphs", subgraphsRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/insights", insightsRouter);
app.route("/api/node", nodeRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/chat-sessions", chatSessionsRouter);
app.route("/api/workflows", workflowsRouter);
app.route("/api/secrets", secretsRouter);
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

					// Write handler file from DB (ensures latest code after redeploys)
					if (row.handler_path && row.handler_code) {
						const { mkdirSync, writeFileSync } = await import("node:fs");
						const { dirname } = await import("node:path");
						mkdirSync(dirname(row.handler_path), { recursive: true });
						writeFileSync(row.handler_path, row.handler_code);
					}

					const mod = await import(`${row.handler_path}?v=${Date.now()}`);
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
		while (
			activeAbortControllers.size > 0 &&
			Date.now() - start < SHUTDOWN_TIMEOUT
		) {
			await new Promise((r) => setTimeout(r, 500));
		}
		if (activeAbortControllers.size > 0) {
			logger.warn("Shutdown timeout, forcing exit", {
				remaining: activeAbortControllers.size,
			});
		}
	}

	await stopSubgraphCache();
	await closeDb();
	server.stop();
	logger.info("API service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
