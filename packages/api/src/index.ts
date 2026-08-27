import { logger } from "@secondlayer/shared";
import { assertDbSplit, closeDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { createApiApp } from "./create-app.ts";
import { createExtendedApp } from "./extended/app.ts";
import {
	isExtendedViewEnabled,
	resolveExtendedPort,
} from "./extended/listen.ts";
import {
	assertInstanceBindAuth,
	resolveInstanceToken,
	resolveListenHost,
} from "./instance-bind.ts";
import { startSubgraphCache, stopSubgraphCache } from "./routes/subgraphs.ts";

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

// Refuse to boot the hosted platform without a shared rate-limit store.
// Without REDIS_URL the limiter falls back to process-local counters
// (`packages/api/src/auth/rate-limit-store.ts:200`), so each replica enforces
// the full limit independently — N replicas silently allow N× the intended
// rate, defeating auth brute-force protection and paid per-key limits. Scoped
// to production: non-prod platform-mode runs keep the warn-only fallback.
if (
	process.env.NODE_ENV === "production" &&
	mode === "platform" &&
	!process.env.REDIS_URL
) {
	logger.error(
		"REDIS_URL is unset in NODE_ENV=production platform mode — refusing to start (rate limits would be process-local and enforced N× per replica)",
	);
	process.exit(1);
}

const app = createApiApp(mode);

// Start server. API_PORT first: in the one-box runtime both planes share one
// environ, so a generic PORT would collide with the indexer's bind.
const PORT = Number.parseInt(
	process.env.API_PORT || process.env.PORT || "3800",
);
const listenHost = mode === "oss" ? resolveListenHost() : "0.0.0.0";
if (mode === "oss") {
	try {
		assertInstanceBindAuth({
			host: listenHost,
			token: resolveInstanceToken(),
		});
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

logger.info("Starting API service", {
	port: PORT,
	hostname: listenHost,
	mode,
});

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
	hostname: listenHost,
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

// Optional `/extended` view on a separate port. Off by default. Never on :3800.
let extendedServer: ReturnType<typeof Bun.serve> | null = null;
if (mode === "oss" && isExtendedViewEnabled()) {
	const extendedApp = createExtendedApp();
	const extendedPort = resolveExtendedPort();
	extendedServer = Bun.serve({
		port: extendedPort,
		hostname: listenHost,
		fetch: extendedApp.fetch,
		idleTimeout: 90,
	});
	logger.info("Starting extended view", {
		port: extendedPort,
		hostname: listenHost,
		surface: "extended",
	});
}

const shutdown = async () => {
	logger.info("Shutting down API service...");

	await stopSubgraphCache();
	await closeDb();
	extendedServer?.stop();
	server.stop();
	logger.info("API service stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
