import { logger } from "@secondlayer/shared";
import { assertDbSplit, closeDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "./auth/index.ts";
import { requireAdmin } from "./middleware/admin.ts";
import { staticKeyAuth } from "./middleware/auth-modes.ts";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import { countApiRequests } from "./middleware/usage.ts";
import accountsRouter from "./routes/accounts.ts";
import adminRouter from "./routes/admin.ts";
import authRouter from "./routes/auth.ts";
import { createBatchRouter } from "./routes/batch.ts";
import billingRouter from "./routes/billing.ts";
import contractsRouter from "./routes/contracts.ts";
import indexRouter from "./routes/index.ts";
import insightsRouter from "./routes/insights.ts";
import nodeRouter from "./routes/node.ts";
import openApiRouter from "./routes/openapi.ts";
import projectsRouter from "./routes/projects.ts";
import statusRouter from "./routes/status.ts";
import streamsRouter from "./routes/streams.ts";
import subgraphsRouter, {
	startSubgraphCache,
	stopSubgraphCache,
} from "./routes/subgraphs.ts";
import subscriptionsRouter from "./routes/subscriptions.ts";
import v1ApiKeysRouter from "./routes/v1-api-keys.ts";
import v1IndexRouter from "./routes/v1-index.ts";
import v1KeysRouter from "./routes/v1-keys.ts";
import v1SubgraphsRouter from "./routes/v1-subgraphs.ts";
import walletRouter from "./routes/wallet.ts";
import webhooksStripeRouter from "./routes/webhooks-stripe.ts";
import x402Router from "./routes/x402.ts";
import { apiTelemetry } from "./telemetry/api.ts";
import { isX402Enabled } from "./x402/facilitator.ts";
import { primeSpot } from "./x402/spot.ts";

const mode = getInstanceMode();

// Refuse to boot if DEV_MODE leaked into production. DEV_MODE bypasses
// auth (`packages/api/src/auth/middleware.ts:18`) and leaks magic-link
// tokens in response bodies (`auth.ts:84`); a single typo on the host
// would mean total compromise. Catch it at startup, not at runtime.
if (process.env.NODE_ENV === "production" && process.env.DEV_MODE === "true") {
	logger.error(
		"DEV_MODE=true is set in NODE_ENV=production — refusing to start",
	);
	process.exit(1);
}

const app = new Hono();

// Global middleware
//
// Two CORS policies (open beta, 2026-05):
//  - `/api/*` (session-cookie + Bearer; mutations): allowlist + credentials.
//    Wildcard here would let any page invoke billing/keys/auth from a
//    victim's browser.
//  - Public read surfaces (`/v1/*`, `/health`, `/public/*`): wildcard origin,
//    no credentials. Anyone should be able to fetch sBTC/BNS events or
//    paginate Streams from a third-party app. Rate-limit headers are exposed
//    so clients can read them.
const dashboardOrigins = (
	process.env.DASHBOARD_ORIGINS ||
	"https://secondlayer.tools,https://www.secondlayer.tools,https://app.secondlayer.tools,http://localhost:3000"
)
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

const PUBLIC_EXPOSE_HEADERS = [
	"X-RateLimit-Limit",
	"X-RateLimit-Remaining",
	"X-RateLimit-Reset",
	"Retry-After",
	"ETag",
	"X-Signature",
	"X-Signature-KeyId",
];

const publicCors = cors({
	origin: "*",
	credentials: false,
	allowMethods: ["GET", "OPTIONS"],
	allowHeaders: ["Authorization", "Content-Type"],
	exposeHeaders: PUBLIC_EXPOSE_HEADERS,
	maxAge: 86400,
});

const platformCors = cors({
	origin: dashboardOrigins,
	credentials: true,
	allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	allowHeaders: ["Authorization", "Content-Type", "X-Provisioner-Secret"],
});

app.use("/v1/*", publicCors);
app.use("/health", publicCors);
app.use("/public/*", publicCors);
app.use("/api/*", platformCors);
app.use("*", requestLogger);
app.use("*", apiTelemetry());

// Global error handler
app.onError(errorHandler);

// Unmatched routes — always JSON, never text/plain.
app.notFound((c) =>
	c.json({ error: "Not Found", code: "NOT_FOUND", path: c.req.path }, 404),
);

/**
 * Resource auth middleware applied per instance mode.
 * - oss: `staticKeyAuth` (pass-through unless `API_KEY` env is set)
 * - platform: `requireAuth` (magic-link sessions + sk-sl_ API keys)
 */
function resourceAuth(): MiddlewareHandler {
	if (mode === "oss") return staticKeyAuth();
	return requireAuth();
}

// Platform-only routes — skipped in oss/dedicated modes.
if (mode === "platform") {
	// Key management (session-scoped API key CRUD)
	app.route("/api/keys", keysRouter);

	// Auth routes (no auth required, IP rate limited)
	app.use("/api/auth/*", ipRateLimit(10));
	app.route("/api/auth", authRouter);

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
// - Platform: control plane + subgraphs + subscriptions (shared-rip 2026-05-14
//   brought subgraphs back onto the platform API after the dedicated
//   per-tenant model was scrapped pre-launch).
// - Dedicated: same surface plus /api/node passthrough. Dormant post-rip.
// - OSS: full single-tenant deployment.
const DEDICATED_PATHS = [
	"/status",
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/subscriptions",
	"/api/subscriptions/*",
	"/api/node",
	"/api/node/*",
];

const PLATFORM_PATHS = [
	"/status",
	"/api/accounts",
	"/api/accounts/*",
	"/api/billing",
	"/api/billing/*",
	"/api/wallet",
	"/api/wallet/*",
	"/api/insights",
	"/api/insights/*",
	"/api/projects",
	"/api/projects/*",
	"/api/tenants",
	"/api/tenants/*",
	"/api/auth/logout",
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/subscriptions",
	"/api/subscriptions/*",
];

const paths = mode === "platform" ? PLATFORM_PATHS : DEDICATED_PATHS;

for (const path of paths) {
	app.use(path, resourceAuth());
	if (mode === "platform") {
		app.use(path, rateLimit());
		app.use(path, countApiRequests());
	}
}

// Subgraph + subscription routes mount in all modes (shared-rip 2026-05-14
// brought subgraphs back onto the platform API). /api/node stays
// oss/dedicated-only — node reads aren't a platform concern.
app.route("/api/subgraphs", subgraphsRouter);
app.route("/api/subscriptions", subscriptionsRouter);
if (mode !== "platform") {
	app.route("/api/node", nodeRouter);
}
if (mode === "platform") {
	app.route("/api/accounts", accountsRouter);
	app.route("/api/billing", billingRouter);
	app.route("/api/wallet", walletRouter);
	app.route("/api/insights", insightsRouter);
	app.route("/api/projects", projectsRouter);
}
app.route("/", statusRouter);
app.route("/v1", v1IndexRouter);
app.route("/v1/openapi.json", openApiRouter);
app.route("/v1/streams", streamsRouter);
app.route("/v1/index", indexRouter);
app.route("/v1/subgraphs", v1SubgraphsRouter);
app.route("/v1/contracts", contractsRouter);
app.route("/x402", x402Router);
// /v1 alias so agents probing the public namespace find the rail; .well-known
// gives off-the-shelf x402 discovery tooling a stable pointer.
app.route("/v1/x402", x402Router);
// Batch reads re-dispatch through the full pipeline (closure over `app`),
// so every item keeps its own auth/quota/x402 semantics.
app.route(
	"/v1/batch",
	createBatchRouter((path, init) => Promise.resolve(app.request(path, init))),
);
app.get("/.well-known/x402", (c) =>
	c.json({
		x402Version: 2,
		supported: "/v1/x402/supported",
		docs: "https://secondlayer.tools/pricing#pay-per-call",
	}),
);
// Agent-reachable scoped key mint — platform-only (OSS uses a static key).
if (mode === "platform") {
	app.route("/v1/api-keys", v1ApiKeysRouter);
	// Anonymous ghost-key mint (no auth; per-IP + global daily caps inside).
	app.route("/v1/keys", v1KeysRouter);
}

// Start server
const PORT = Number.parseInt(process.env.PORT || "3800");

logger.info("Starting API service", { port: PORT, mode });

// Start subgraph registry cache (LISTEN for subgraph_changes) — runs in all
// modes post shared-rip; subgraphs live on the platform DB too.
startSubgraphCache().catch((err) => {
	logger.warn("Failed to start subgraph cache, subgraphs will load on-demand", {
		error: String(err),
	});
});

assertDbSplit();
const server = Bun.serve({
	port: PORT,
	fetch: app.fetch,
	// Bun's default `idleTimeout` is 10s. We have legitimate long-tail
	// requests that exceed that:
	//   - BNS print scans against unindexed jsonb (5–20s during backfill)
	//   - `DELETE /api/subgraphs/<name>` waiting for active reindex ops to
	//     drain via `waitForSubgraphOperationsClear` (up to 30s)
	//   - sBTC/streams pagination over dense contract ranges
	// Closing the socket mid-response surfaces as either
	// `socket connection closed unexpectedly` (downstream consumers) or a
	// generic 5xx in the SDK (DELETE finishes server-side but the client
	// already gave up). 90s comfortably covers both cases.
	//
	// 🛑 Don't revert without also lengthening the wait-for-clear timeout in
	// `routes/subgraphs.ts` and tuning streams page sizes. This was silently
	// reverted in commit 9a4c8d35 after first landing in 0650816b — keep it.
	idleTimeout: 90,
});

// Warm the x402 spot cache at boot so the first 402s carry live prices, not the
// env fallback. Best-effort + non-blocking (failures are logged + backed off).
if (isX402Enabled()) {
	void primeSpot();
}

const shutdown = async () => {
	logger.info("Shutting down API service...");

	await stopSubgraphCache();
	await closeDb();
	server.stop();
	logger.info("API service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
