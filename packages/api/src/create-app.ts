import type { InstanceMode } from "@secondlayer/shared/mode";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
	ipRateLimit,
	keysRouter,
	rateLimit,
	requireAuth,
} from "./auth/index.ts";
import { requireAdmin } from "./middleware/admin.ts";
import { instanceTokenAuth } from "./middleware/auth-modes.ts";
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
import subgraphsRouter from "./routes/subgraphs.ts";
import subscriptionsRouter from "./routes/subscriptions.ts";
import v1ApiKeysRouter from "./routes/v1-api-keys.ts";
import v1IndexRouter from "./routes/v1-index.ts";
import v1KeysRouter from "./routes/v1-keys.ts";
import v1SubgraphsRouter from "./routes/v1-subgraphs.ts";
import walletRouter from "./routes/wallet.ts";
import webhooksStripeRouter from "./routes/webhooks-stripe.ts";
import x402Router from "./routes/x402.ts";
import { apiTelemetry } from "./telemetry/api.ts";

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

const PUBLIC_EXPOSE_HEADERS = [
	"X-RateLimit-Limit",
	"X-RateLimit-Remaining",
	"X-RateLimit-Reset",
	"Retry-After",
	"ETag",
	"X-Signature",
	"X-Signature-KeyId",
];

/** Hono app with routes for `mode`. Does not listen or start the cache. */
export function createApiApp(mode: InstanceMode): Hono {
	const app = new Hono();

	const dashboardOrigins = (
		process.env.DASHBOARD_ORIGINS ||
		"https://secondlayer.tools,https://www.secondlayer.tools,https://app.secondlayer.tools,http://localhost:3000"
	)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

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
	app.onError(errorHandler);
	app.notFound((c) =>
		c.json({ error: "Not Found", code: "NOT_FOUND", path: c.req.path }, 404),
	);

	const resourceAuth: MiddlewareHandler =
		mode === "oss" ? instanceTokenAuth() : requireAuth();

	if (mode === "platform") {
		app.route("/api/keys", keysRouter);
		app.use("/api/auth/*", ipRateLimit(10));
		app.route("/api/auth", authRouter);
		app.route("/api/webhooks/stripe", webhooksStripeRouter);
		app.use("/api/admin/*", requireAuth());
		app.use("/api/admin/*", requireAdmin());
		app.route("/api/admin", adminRouter);
	}

	const paths = mode === "platform" ? PLATFORM_PATHS : DEDICATED_PATHS;
	for (const path of paths) {
		app.use(path, resourceAuth);
		if (mode === "platform") {
			app.use(path, rateLimit());
			app.use(path, countApiRequests());
		}
	}

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
	app.route(
		"/v1/batch",
		createBatchRouter((path, init) => Promise.resolve(app.request(path, init))),
	);
	if (mode === "platform") {
		app.route("/x402", x402Router);
		app.route("/v1/x402", x402Router);
		app.get("/.well-known/x402", (c) =>
			c.json({
				x402Version: 2,
				supported: "/v1/x402/supported",
				docs: "https://secondlayer.tools/pricing#pay-per-call",
			}),
		);
		app.route("/v1/api-keys", v1ApiKeysRouter);
		app.route("/v1/keys", v1KeysRouter);
	}

	return app;
}
