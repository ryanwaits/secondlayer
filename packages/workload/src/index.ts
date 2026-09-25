/**
 * The workload host process: gateway + provisioner + meters in one Bun
 * process (044 executor notes — one process runs both, not two services).
 *
 * Required env:
 *   CONTROL_DATABASE_URL   this host's own control Postgres (never a tenant's)
 *   APP_SERVER_URL         e.g. https://api.secondlayer.tools
 *   WORKLOAD_HOST_KEY      shared with app-server's /internal/keys/introspect,
 *                          /internal/keys/tenant, /internal/accounts/credits,
 *                          and /internal/meters guards
 *   TENANT_SECRETS_ROOT    root-only dir, one subdirectory per tenant
 *   TENANT_COMPOSE_FILE    docker/workload/tenant.compose.yml
 *   WORKLOAD_IMAGE_TAG     deployed main sha `tenant.compose.yml` pins
 *                          `secondlayer-api` to (required there, no `latest`
 *                          default); flows through to `docker compose` via
 *                          spawnCompose's `process.env` merge
 *   GATEWAY_PORT           default 8080
 *
 * Review fix 7: the gateway binds 127.0.0.1 only — a local Caddy
 * (`docker/workload-host/Caddyfile`) terminates :443 and reverse-proxies to
 * it. This process never listens on a public interface itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_METER_BATCH } from "@secondlayer/platform/billing/prices";
import { logger } from "@secondlayer/shared";
import {
	type TenantRow,
	acct8For,
	ensureControlSchema,
	getControlDb,
	getTenant,
	listRunningTenants,
} from "./control-db.ts";
import { handleGatewayRequest } from "./gateway.ts";
import { IntrospectClient } from "./introspect-client.ts";
import {
	EventCounter,
	type MeterBatchItem,
	eventsMeterItem,
	flushAll,
	sampleMemoryGbHour,
	sampleStorageGbDay,
	sampleTenantDatabaseBytes,
	sampleTenantMemoryBytes,
	startMeterSocketServer,
} from "./meters.ts";
import {
	type ProvisionerConfig,
	pollCredits,
	start as provisionStart,
	up as provisionUp,
} from "./provisioner.ts";
import { createRateLimiter } from "./rate-limiter.ts";

const METER_FLUSH_INTERVAL_MS = 60_000;
const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
const MEMORY_FLUSH_INTERVAL_MS = 60 * 60_000; // hourly (Design)
const STORAGE_SAMPLE_INTERVAL_MS = 24 * 60 * 60_000; // daily (Design)
const CREDITS_POLL_INTERVAL_MS = 5 * 60_000; // Design: "every 5 min"

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
	// Not read past this point — validated up front so a missing tag fails
	// fast at startup instead of at the first `docker compose up` (it reaches
	// compose via spawnCompose's `process.env` merge, not through this value).
	requireEnv("WORKLOAD_IMAGE_TAG");
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
		workloadHostKey,
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

	/** Loopback-only: the gateway is a host process with no compose-network
	 *  DNS (review fix 1 — `tenant-<acct8>-api` never resolved from here).
	 *  `api_port` comes from the control DB (allocated once, at insert,
	 *  never reused); `INSTANCE_TOKEN` from that tenant's own secrets file
	 *  (never the control DB, which holds no secrets). */
	async function tenantUpstream(
		accountId: string,
	): Promise<{ baseUrl: string; instanceToken: string }> {
		const row = await getTenant(db, accountId);
		if (!row) throw new Error(`no tenant row for ${accountId}`);
		const acct8 = acct8For(accountId);
		const envPath = join(secretsRoot, acct8, ".env");
		const contents = readFileSync(envPath, "utf8");
		const match = contents.match(/^INSTANCE_TOKEN=(.+)$/m);
		if (!match) throw new Error(`no INSTANCE_TOKEN for tenant-${acct8}`);
		return {
			baseUrl: `http://127.0.0.1:${row.api_port}`,
			instanceToken: match[1] ?? "",
		};
	}

	const server = Bun.serve({
		port: gatewayPort,
		hostname: "127.0.0.1",
		fetch: (req) =>
			handleGatewayRequest(
				{
					introspect,
					resolveTenant: async (accountId) => {
						const row = await getTenant(db, accountId);
						if (row) ensureMeterSocket(accountId);
						return row?.state;
					},
					startProvisioning: (accountId) => {
						provisionUp(provisionerCfg, accountId)
							.then(() => ensureMeterSocket(accountId))
							.catch((err) => {
								logger.error("workload.provisioner.up_background_failed", {
									accountId,
									error: err instanceof Error ? err.message : String(err),
								});
							});
					},
					startTenant: (accountId) => {
						provisionStart(provisionerCfg, accountId).catch((err) => {
							logger.error("workload.provisioner.start_background_failed", {
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
	logger.info("workload gateway ready", {
		port: server.port,
		hostname: "127.0.0.1",
	});

	// Event meter flush (step 5): drains each tenant's in-memory delivered
	// count every 60s.
	const eventFlushLoop = setInterval(async () => {
		const items: MeterBatchItem[] = [];
		for (const [accountId, counter] of eventCounters) {
			const item = eventsMeterItem(accountId, counter.drain());
			if (item) items.push(item);
		}
		await flushAll({ appServerUrl, workloadHostKey }, items, MAX_METER_BATCH);
	}, METER_FLUSH_INTERVAL_MS);

	// Memory meter (review fix 4): sample every 60s, accumulate GB-hours per
	// account, flush hourly. `runningTenants` re-lists every tick so a
	// newly-running or newly-stopped tenant is picked up/dropped without a
	// restart.
	const memoryAccumulatorGbHours = new Map<string, number>();
	const memorySampleLoop = setInterval(async () => {
		let running: TenantRow[];
		try {
			running = await listRunningTenants(db);
		} catch (err) {
			logger.error("workload.meters.memory_sample_list_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		for (const tenant of running) {
			try {
				const item = await sampleMemoryGbHour(
					tenant.account_id,
					(accountId) => sampleTenantMemoryBytes(acct8For(accountId)),
					MEMORY_SAMPLE_INTERVAL_MS / 1000,
				);
				memoryAccumulatorGbHours.set(
					tenant.account_id,
					(memoryAccumulatorGbHours.get(tenant.account_id) ?? 0) +
						item.quantity,
				);
			} catch (err) {
				logger.error("workload.meters.memory_sample_failed", {
					accountId: tenant.account_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}, MEMORY_SAMPLE_INTERVAL_MS);

	const memoryFlushLoop = setInterval(async () => {
		const now = new Date();
		const items: MeterBatchItem[] = [];
		for (const [accountId, gbHours] of memoryAccumulatorGbHours) {
			if (gbHours <= 0) continue;
			items.push({
				accountId,
				unit: "memory.gb_hour",
				quantity: gbHours,
				idempotencyKey: `mem:${accountId}:${now.toISOString().slice(0, 13)}`,
			});
		}
		memoryAccumulatorGbHours.clear();
		await flushAll({ appServerUrl, workloadHostKey }, items, MAX_METER_BATCH);
	}, MEMORY_FLUSH_INTERVAL_MS);

	// Storage meter (review fix 4): sample + flush daily.
	const storageLoop = setInterval(async () => {
		let running: TenantRow[];
		try {
			running = await listRunningTenants(db);
		} catch (err) {
			logger.error("workload.meters.storage_sample_list_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		const items: MeterBatchItem[] = [];
		for (const tenant of running) {
			try {
				const item = await sampleStorageGbDay(tenant.account_id, (accountId) =>
					sampleTenantDatabaseBytes(acct8For(accountId)),
				);
				items.push(item);
			} catch (err) {
				logger.error("workload.meters.storage_sample_failed", {
					accountId: tenant.account_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		await flushAll({ appServerUrl, workloadHostKey }, items, MAX_METER_BATCH);
	}, STORAGE_SAMPLE_INTERVAL_MS);

	// Zero-balance / top-up poll (review fix 3a): running→stopped,
	// stopped→running, every 5 minutes (Design).
	const creditsPollLoop = setInterval(() => {
		pollCredits(provisionerCfg).catch((err) => {
			logger.error("workload.provisioner.poll_credits_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}, CREDITS_POLL_INTERVAL_MS);

	const shutdown = () => {
		logger.info("workload host shutting down");
		clearInterval(eventFlushLoop);
		clearInterval(memorySampleLoop);
		clearInterval(memoryFlushLoop);
		clearInterval(storageLoop);
		clearInterval(creditsPollLoop);
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
