/**
 * The workload host process: gateway + provisioner + meters in one Bun
 * process (044 executor notes — one process runs both, not two services).
 *
 * Required env:
 *   CONTROL_DATABASE_URL   this host's own control Postgres (never a tenant's)
 *   APP_SERVER_URL         e.g. https://api.secondlayer.tools
 *   WORKLOAD_HOST_KEY      shared with app-server's /internal/keys/introspect
 *                          and /internal/meters guards
 *   TENANT_SECRETS_ROOT    root-only dir, one subdirectory per tenant
 *   TENANT_COMPOSE_FILE    docker/workload/tenant.compose.yml
 *   GATEWAY_PORT           default 8080
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_METER_BATCH } from "@secondlayer/platform/billing/prices";
import { logger } from "@secondlayer/shared";
import {
	acct8For,
	ensureControlSchema,
	getControlDb,
	getTenant,
} from "./control-db.ts";
import { handleGatewayRequest } from "./gateway.ts";
import { IntrospectClient } from "./introspect-client.ts";
import {
	EventCounter,
	eventsMeterItem,
	flushAll,
	startMeterSocketServer,
} from "./meters.ts";
import { type ProvisionerConfig, up as provisionUp } from "./provisioner.ts";
import { createRateLimiter } from "./rate-limiter.ts";

const METER_FLUSH_INTERVAL_MS = 60_000;

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main(): Promise<void> {
	const controlDbUrl = requireEnv("CONTROL_DATABASE_URL");
	const appServerUrl = requireEnv("APP_SERVER_URL");
	const workloadHostKey = requireEnv("WORKLOAD_HOST_KEY");
	const secretsRoot = requireEnv("TENANT_SECRETS_ROOT");
	const composeFile = requireEnv("TENANT_COMPOSE_FILE");
	const gatewayPort = Number(process.env.GATEWAY_PORT ?? 8080);

	const db = getControlDb(controlDbUrl);
	await ensureControlSchema(db);

	const introspect = new IntrospectClient({ appServerUrl, workloadHostKey });
	const rateLimit = createRateLimiter();

	const provisionerCfg: ProvisionerConfig = {
		db,
		secretsRoot,
		composeFile,
		hostedApiUrl: appServerUrl,
	};

	// One EventCounter + meter-socket server per running tenant, started the
	// moment we know about it and torn down on destroy. Keyed by accountId,
	// not acct8, so a lookup never needs the derivation twice.
	const eventCounters = new Map<string, EventCounter>();
	const socketServers = new Map<string, { stop: () => void }>();

	function ensureMeterSocket(accountId: string): EventCounter {
		const existing = eventCounters.get(accountId);
		if (existing) return existing;
		const counter = new EventCounter();
		const acct8 = acct8For(accountId);
		const socketPath = join(secretsRoot, acct8, "sockets", "meter.sock");
		try {
			socketServers.set(accountId, startMeterSocketServer(socketPath, counter));
		} catch (err) {
			// Socket dir doesn't exist yet (provisioning in flight) — the next
			// meter tick retries; a missing socket just means zero events this
			// tick, never a crash.
			logger.warn("workload.meters.socket_start_deferred", {
				accountId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		eventCounters.set(accountId, counter);
		return counter;
	}

	async function tenantUpstream(
		accountId: string,
	): Promise<{ baseUrl: string; instanceToken: string }> {
		const acct8 = acct8For(accountId);
		const envPath = join(secretsRoot, acct8, ".env");
		const contents = readFileSync(envPath, "utf8");
		const match = contents.match(/^INSTANCE_TOKEN=(.+)$/m);
		if (!match) throw new Error(`no INSTANCE_TOKEN for tenant-${acct8}`);
		return {
			baseUrl: `http://tenant-${acct8}-api:3800`,
			instanceToken: match[1] ?? "",
		};
	}

	const server = Bun.serve({
		port: gatewayPort,
		fetch: (req) =>
			handleGatewayRequest(
				{
					introspect,
					resolveTenant: async (accountId) => {
						const row = await getTenant(db, accountId);
						if (row) ensureMeterSocket(accountId);
						return row?.state;
					},
					startProvisioning: (accountId, accountKey) => {
						provisionUp(provisionerCfg, accountId, accountKey)
							.then(() => ensureMeterSocket(accountId))
							.catch((err) => {
								logger.error("workload.provisioner.up_background_failed", {
									accountId,
									error: err instanceof Error ? err.message : String(err),
								});
							});
					},
					tenantUpstream,
					rateLimit,
				},
				req,
			),
	});
	logger.info("workload gateway ready", { port: server.port });

	const flushLoop = setInterval(async () => {
		const items = [];
		for (const [accountId, counter] of eventCounters) {
			const item = eventsMeterItem(accountId, counter.drain());
			if (item) items.push(item);
		}
		await flushAll({ appServerUrl, workloadHostKey }, items, MAX_METER_BATCH);
	}, METER_FLUSH_INTERVAL_MS);

	const shutdown = () => {
		logger.info("workload host shutting down");
		clearInterval(flushLoop);
		for (const s of socketServers.values()) s.stop();
		server.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	logger.error("workload host failed to start", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
