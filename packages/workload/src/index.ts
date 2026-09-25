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
 *   GATEWAY_PORT           default 8080
 *
 * There is no `WORKLOAD_IMAGE_TAG` env anymore (plan 064): the deployed sha
 * `tenant.compose.yml` pins `secondlayer-api` to is DERIVED, not configured
 * — this process polls app-server `/health`'s `image_sha` every 5 minutes
 * (piggybacking on the credits-poll interval) and passes whatever it last
 * resolved to `docker compose` per call. A prod deploy now reaches every
 * tenant within one poll interval instead of waiting for an operator to bump
 * an env var and re-up each stack by hand.
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
	DEFAULT_PENDING_CAP,
	EventCounter,
	type MeterBatchItem,
	eventsMeterItem,
	flushAll,
	mergePending,
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
import {
	createTargetShaCache,
	createUpgradeRunner,
	resolveTargetSha,
} from "./upgrade.ts";

const METER_FLUSH_INTERVAL_MS = 60_000;
const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
const MEMORY_FLUSH_INTERVAL_MS = 60 * 60_000; // hourly (Design)
const STORAGE_SAMPLE_INTERVAL_MS = 24 * 60 * 60_000; // daily (Design)
const CREDITS_POLL_INTERVAL_MS = 5 * 60_000; // Design: "every 5 min"
const INITIAL_TARGET_RESOLUTION_ATTEMPTS = 3;
const INITIAL_TARGET_RESOLUTION_RETRY_MS = 2_000;

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

	// The deployed target sha is derived from app-server's `/health`, not
	// configured (plan 064) — `getTargetSha` always reads whatever this cache
	// holds at call time, never a value captured once at process start.
	const targetShaCache = createTargetShaCache();
	for (
		let attempt = 1;
		attempt <= INITIAL_TARGET_RESOLUTION_ATTEMPTS;
		attempt++
	) {
		const sha = await resolveTargetSha(appServerUrl, fetch, targetShaCache);
		if (sha) break;
		if (attempt < INITIAL_TARGET_RESOLUTION_ATTEMPTS) {
			await new Promise((r) =>
				setTimeout(r, INITIAL_TARGET_RESOLUTION_RETRY_MS),
			);
		}
	}
	if (!targetShaCache.lastGood) {
		// Existing tenants keep running on whatever they're already on — only
		// NEW provisioning (`up()`'s `requireTargetSha`) refuses until the next
		// poll resolves something.
		logger.error("workload.upgrade.no_initial_target", {
			attempts: INITIAL_TARGET_RESOLUTION_ATTEMPTS,
		});
	}

	const provisionerCfg: ProvisionerConfig = {
		db,
		secretsRoot,
		composeFile,
		hostedApiUrl: appServerUrl,
		workloadHostKey,
		getTargetSha: () => targetShaCache.lastGood,
	};
	const runUpgradeRound = createUpgradeRunner(provisionerCfg);

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
	// count every 60s. A failed flush's items come back from `flushAll` and
	// are resent (unchanged — same idempotency keys) ahead of the next
	// tick's fresh items, so an app-server outage delays a batch instead of
	// losing it.
	let eventPending: MeterBatchItem[] = [];
	const eventFlushLoop = setInterval(async () => {
		const fresh: MeterBatchItem[] = [];
		for (const [accountId, counter] of eventCounters) {
			const item = eventsMeterItem(accountId, counter.drain());
			if (item) fresh.push(item);
		}
		const { items, droppedCount } = mergePending(
			eventPending,
			fresh,
			DEFAULT_PENDING_CAP,
		);
		if (droppedCount > 0) {
			logger.error("workload.meters.pending_overflow", {
				loop: "events",
				droppedCount,
			});
		}
		eventPending = await flushAll(
			{ appServerUrl, workloadHostKey },
			items,
			MAX_METER_BATCH,
		);
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

	let memoryPending: MeterBatchItem[] = [];
	const memoryFlushLoop = setInterval(async () => {
		const now = new Date();
		const fresh: MeterBatchItem[] = [];
		for (const [accountId, gbHours] of memoryAccumulatorGbHours) {
			if (gbHours <= 0) continue;
			fresh.push({
				accountId,
				unit: "memory.gb_hour",
				quantity: gbHours,
				idempotencyKey: `mem:${accountId}:${now.toISOString().slice(0, 13)}`,
			});
		}
		memoryAccumulatorGbHours.clear();
		const { items, droppedCount } = mergePending(
			memoryPending,
			fresh,
			DEFAULT_PENDING_CAP,
		);
		if (droppedCount > 0) {
			logger.error("workload.meters.pending_overflow", {
				loop: "memory",
				droppedCount,
			});
		}
		memoryPending = await flushAll(
			{ appServerUrl, workloadHostKey },
			items,
			MAX_METER_BATCH,
		);
	}, MEMORY_FLUSH_INTERVAL_MS);

	// Storage meter (review fix 4): sample + flush daily.
	let storagePending: MeterBatchItem[] = [];
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
		const fresh: MeterBatchItem[] = [];
		for (const tenant of running) {
			try {
				const item = await sampleStorageGbDay(tenant.account_id, (accountId) =>
					sampleTenantDatabaseBytes(acct8For(accountId)),
				);
				fresh.push(item);
			} catch (err) {
				logger.error("workload.meters.storage_sample_failed", {
					accountId: tenant.account_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		const { items, droppedCount } = mergePending(
			storagePending,
			fresh,
			DEFAULT_PENDING_CAP,
		);
		if (droppedCount > 0) {
			logger.error("workload.meters.pending_overflow", {
				loop: "storage",
				droppedCount,
			});
		}
		storagePending = await flushAll(
			{ appServerUrl, workloadHostKey },
			items,
			MAX_METER_BATCH,
		);
	}, STORAGE_SAMPLE_INTERVAL_MS);

	// Zero-balance / top-up poll (review fix 3a): running→stopped,
	// stopped→running, every 5 minutes (Design). Piggybacks the target-sha
	// resolution + rolling upgrade (plan 064) on the same interval — simpler
	// than a second timer, and both are 5-minute-cadence background sweeps
	// over the same tenant set.
	const creditsPollLoop = setInterval(async () => {
		const targetSha = await resolveTargetSha(
			appServerUrl,
			fetch,
			targetShaCache,
		);
		if (targetSha) {
			await runUpgradeRound(targetSha).catch((err) => {
				logger.error("workload.upgrade.round_failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			});
		}
		await pollCredits(provisionerCfg).catch((err) => {
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
