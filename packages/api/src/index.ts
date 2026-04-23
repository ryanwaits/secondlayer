import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "@secondlayer/auth";
import { logger } from "@secondlayer/shared";
import { closeDb, getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { requireAdmin } from "./middleware/admin.ts";
import { dedicatedAuth, staticKeyAuth } from "./middleware/auth-modes.ts";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import {
	getLastRequestAtMs,
	trackTenantActivity,
} from "./middleware/tenant-activity.ts";
import { countApiRequests } from "./middleware/usage.ts";
import accountsRouter from "./routes/accounts.ts";
import adminRouter from "./routes/admin.ts";
import authRouter from "./routes/auth.ts";
import billingRouter from "./routes/billing.ts";
import chatSessionsRouter from "./routes/chat-sessions.ts";
import insightsRouter from "./routes/insights.ts";
import nodeRouter from "./routes/node.ts";
import projectsRouter from "./routes/projects.ts";
import statusRouter from "./routes/status.ts";
import subgraphsRouter, {
	abortAllOperations,
	activeAbortControllers,
	startSubgraphCache,
	stopSubgraphCache,
} from "./routes/subgraphs.ts";
import tenantsRouter from "./routes/tenants.ts";
import waitlistRouter from "./routes/waitlist.ts";
import webhooksStripeRouter from "./routes/webhooks-stripe.ts";

const mode = getInstanceMode();
const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", requestLogger);

// Global error handler
app.onError(errorHandler);

/**
 * Resource auth middleware applied per instance mode.
 * - oss: `staticKeyAuth` (pass-through unless `API_KEY` env is set)
 * - dedicated: `dedicatedAuth` (HS256 JWT with anon/service role)
 * - platform: `requireAuth` (magic-link sessions + sk-sl_ API keys)
 */
function resourceAuth(): MiddlewareHandler {
	if (mode === "dedicated") return dedicatedAuth();
	if (mode === "oss") return staticKeyAuth();
	return requireAuth();
}

// Dedicated-mode-only: track tenant activity + expose it to the worker
// health cron so the control plane can auto-pause idle Hobby tenants.
if (mode === "dedicated") {
	app.use("*", trackTenantActivity());
	app.get("/internal/activity", (c) => {
		const lastRequestAtMs = getLastRequestAtMs();
		return c.json({
			lastRequestAt:
				lastRequestAtMs > 0 ? new Date(lastRequestAtMs).toISOString() : null,
		});
	});
}

// Platform-only routes — skipped in oss/dedicated modes.
if (mode === "platform") {
	// Key management (session-scoped API key CRUD)
	app.route("/api/keys", keysRouter);

	// Auth routes (no auth required, IP rate limited)
	app.use("/api/auth/*", ipRateLimit(10));
	app.route("/api/auth", authRouter);

	// Waitlist (no auth required)
	app.route("/api/waitlist", waitlistRouter);

	// Stripe webhook — no auth; signature is verified inside the route.
	// IP rate limiting intentionally skipped (Stripe's egress is trusted
	// and they retry aggressively on non-2xx).
	app.route("/api/webhooks/stripe", webhooksStripeRouter);

	// Admin routes — auth + admin guard
	app.use("/api/admin/*", requireAuth());
	app.use("/api/admin/*", requireAdmin());
	app.route("/api/admin", adminRouter);
}

// Resource paths per mode.
// - Platform: control plane only (accounts, projects, tenants, chat, insights,
//   auth/logout, admin). NO /api/subgraphs — subgraphs live on per-tenant
//   dedicated containers now.
// - Dedicated: serves /api/subgraphs on its tenant DB; /api/node read-through.
// - OSS: full single-tenant deployment.
const DEDICATED_PATHS = [
	"/status",
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/node",
	"/api/node/*",
];

const PLATFORM_PATHS = [
	"/status",
	"/api/accounts",
	"/api/accounts/*",
	"/api/billing",
	"/api/billing/*",
	"/api/insights",
	"/api/insights/*",
	"/api/projects",
	"/api/projects/*",
	"/api/chat-sessions",
	"/api/chat-sessions/*",
	"/api/tenants",
	"/api/tenants/*",
	"/api/auth/logout",
];

const paths = mode === "platform" ? PLATFORM_PATHS : DEDICATED_PATHS;

for (const path of paths) {
	app.use(path, resourceAuth());
	if (mode === "platform") {
		app.use(path, rateLimit());
		app.use(path, countApiRequests());
	}
}

// Subgraph + node routes run in dedicated/oss mode only — platform is a pure
// control plane post-cutover.
if (mode !== "platform") {
	app.route("/api/subgraphs", subgraphsRouter);
	app.route("/api/node", nodeRouter);
}
if (mode === "platform") {
	app.route("/api/accounts", accountsRouter);
	app.route("/api/billing", billingRouter);
	app.route("/api/insights", insightsRouter);
	app.route("/api/projects", projectsRouter);
	app.route("/api/chat-sessions", chatSessionsRouter);
	app.route("/api/tenants", tenantsRouter);
}
app.route("/", statusRouter);

// Start server
const PORT = Number.parseInt(process.env.PORT || "3800");

logger.info("Starting API service", { port: PORT, mode });

// Start subgraph registry cache (LISTEN for subgraph_changes) — only in modes
// that actually have a `subgraphs` table on their DB (dedicated / oss).
if (mode !== "platform") {
	startSubgraphCache().catch((err) => {
		logger.warn(
			"Failed to start subgraph cache, subgraphs will load on-demand",
			{ error: String(err) },
		);
	});
}

const server = Bun.serve({
	port: PORT,
	fetch: app.fetch,
});

// Auto-resume stale reindexes on startup — dedicated/oss only (platform has
// no subgraphs table post-cutover).
if (mode !== "platform")
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
