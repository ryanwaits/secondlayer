import type { InstanceMode } from "@secondlayer/shared/mode";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { ipRateLimit, keysRouter, requireAuth } from "./auth/index.ts";
import { instanceTokenAuth } from "./middleware/auth-modes.ts";
import { errorHandler } from "./middleware/error.ts";
import { requestLogger } from "./middleware/logging.ts";
import accountsRouter from "./routes/accounts.ts";
import archiveRouter from "./routes/archive.ts";
import authRouter from "./routes/auth.ts";
import { createBatchRouter } from "./routes/batch.ts";
import billingRouter from "./routes/billing.ts";
import contractsRouter from "./routes/contracts.ts";
import indexRouter from "./routes/index.ts";
import {
	createInstanceCatalogRouter,
	renderLocalConsole,
} from "./routes/instance-catalog.ts";
import nodeRouter from "./routes/node.ts";
import openApiRouter from "./routes/openapi.ts";
import publicCreditsRouter from "./routes/public-credits.ts";
import statusRouter from "./routes/status.ts";
import streamsRouter from "./routes/streams.ts";
import subgraphsRouter from "./routes/subgraphs.ts";
import subscriptionsRouter from "./routes/subscriptions.ts";
import v1IndexRouter from "./routes/v1-index.ts";
import v1SubgraphsRouter from "./routes/v1-subgraphs.ts";
import webhooksStripeRouter from "./routes/webhooks-stripe.ts";
import { apiTelemetry } from "./telemetry/api.ts";

/** Routes that run an operator's workload — deploying and executing handler
 *  code, delivering webhooks. Self-host only: the archive deployment serves
 *  data, it does not run anyone's workload (STRATEGY.md, "We do not host
 *  public subgraphs"). */
const WORKLOAD_PATHS = [
	"/api/subgraphs",
	"/api/subgraphs/*",
	"/api/subscriptions",
	"/api/subscriptions/*",
	"/api/node",
	"/api/node/*",
];

/** Account-scoped archive surface: who you are, what you owe, what you hold. */
const ACCOUNT_PATHS = [
	"/api/accounts",
	"/api/accounts/*",
	"/api/billing",
	"/api/billing/*",
	"/api/archive",
	"/api/archive/*",
	"/api/auth/logout",
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
		app.use("/api/public/credits/*", ipRateLimit(20));
		app.route("/api/public/credits", publicCreditsRouter);
	}

	app.use("/status", resourceAuth);

	if (mode !== "platform") {
		for (const path of WORKLOAD_PATHS) app.use(path, resourceAuth);
		app.route("/api/subgraphs", subgraphsRouter);
		app.route("/api/subscriptions", subscriptionsRouter);
		app.route("/api/node", nodeRouter);
	}

	if (mode === "platform") {
		for (const path of ACCOUNT_PATHS) app.use(path, resourceAuth);
		app.route("/api/accounts", accountsRouter);
		app.route("/api/billing", billingRouter);
		app.route("/api/archive", archiveRouter);
	}
	app.route("/", statusRouter);
	app.route("/v1/instance", createInstanceCatalogRouter());
	if (mode === "oss") {
		app.get("/console", (c) => c.html(renderLocalConsole()));
	}
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
	return app;
}
