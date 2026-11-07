/**
 * The workload host process: gateway + provisioner + meters in one Bun
 * process (044 executor notes — one process runs both, not two services).
 *
 * Required env:
 *   CONTROL_DATABASE_URL   this host's own control Postgres (never a tenant's)
 *   APP_SERVER_URL         e.g. https://api.secondlayer.tools
 *   WORKLOAD_HOST_KEY      shared with app-server's /internal/keys/introspect,
 *                          /internal/keys/tenant, /internal/accounts/credits,
 *                          /internal/stack-state, and /internal/meters guards
 *   TENANT_SECRETS_ROOT    root-only dir, one subdirectory per tenant
 *   TENANT_COMPOSE_FILE    docker/workload/tenant.compose.yml
 *   GATEWAY_PORT           default 8080
 *
 * Backups (optional; without them the nightly dump is skipped and tenant
 * destroy refuses to run, see `backups.ts`):
 *   TENANT_BACKUP_BUCKET, TENANT_BACKUP_ENDPOINT,
 *   TENANT_BACKUP_ACCESS_KEY_ID, TENANT_BACKUP_SECRET_ACCESS_KEY,
 *   TENANT_BACKUP_PREFIX   default tenant-backups
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
	backupConfigFromEnv,
	backupTenant,
	pruneFinalBackups,
} from "./backups.ts";
import {
	acct8For,
	ensureControlSchema,
	getControlDb,
	getTenant,
	listRunningTenants,
} from "./control-db.ts";
import { createFailedRequestRecorder } from "./failed-requests.ts";
import { handleGatewayRequest } from "./gateway.ts";
import { IntrospectClient } from "./introspect-client.ts";
import {
	DAILY_JOB_TICK_MS,
	MEMORY_SAMPLE_INTERVAL_MS,
	createBackupTick,
	createMemorySampleTick,
	createStorageSampleTick,
} from "./loops.ts";
import {
	DEFAULT_PENDING_CAP,
	DrainWindow,
	MemoryAccumulator,
	type MeterBatchItem,
	collectShutdownFlushItems,
	createMeterSocketRegistry,
	eventsMeterItem,
	flushAll,
	flushOnShutdown,
	logDroppedMeters,
	mergePending,
	sampleTenantDatabaseBytes,
	sampleTenantMemoryBytes,
} from "./meters.ts";
import {
	createProcessorReconciler,
	createProcessorWatch,
	realProcessorWatchDeps,
} from "./processor-watch.ts";
import {
	type ProvisionerConfig,
	pollCredits,
	start as provisionStart,
	up as provisionUp,
	recoverInterruptedProvisions,
	testnetStackFromEnv,
} from "./provisioner.ts";
import { createPushWatch, createStoppedReporter } from "./push-watch.ts";
import { createRateLimiter } from "./rate-limiter.ts";
import { createStackStateReporter } from "./stack-state-reporter.ts";
import { TenantCache } from "./tenant-cache.ts";
import { skipWhileRunning } from "./tick-guard.ts";
import {
	createTargetShaCache,
	createUpgradeRunner,
	resolveTargetSha,
} from "./upgrade.ts";
import { createWebhookIncidentWatch } from "./webhook-incident-watch.ts";

const METER_FLUSH_INTERVAL_MS = 60_000;
const MEMORY_FLUSH_INTERVAL_MS = 60 * 60_000; // hourly (Design)
const CREDITS_POLL_INTERVAL_MS = 5 * 60_000; // Design: "every 5 min"
const WEBHOOK_INCIDENT_INTERVAL_MS = 60_000;
const PUSH_WATCH_INTERVAL_MS = 60_000;
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;
/** Longest shutdown waits for an in-flight tenant upgrade round: one
 *  `docker compose up -d --wait` plus a rollback up. Must stay below the
 *  unit's `TimeoutStopSec` (180). */
const UPGRADE_DRAIN_MS = 150_000;
const INITIAL_TARGET_RESOLUTION_ATTEMPTS = 3;
const INITIAL_TARGET_RESOLUTION_RETRY_MS = 2_000;

/** The git sha this process started from: `WORKLOAD_SHA` if set, else
 *  `git rev-parse HEAD` in the checkout. Read once at startup, never per
 *  request; `null` when neither works. */
function resolveWorkloadSha(): string | null {
	const fromEnv = process.env.WORKLOAD_SHA?.trim();
	if (fromEnv) return fromEnv;
	try {
		const out = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const sha = out.stdout.toString().trim();
		return out.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

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
	const failedRequests = createFailedRequestRecorder({
		appServerUrl,
		workloadHostKey,
	});
	const stopFailedRequests = failedRequests.start();
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

	const backups = backupConfigFromEnv();
	if (!backups) {
		logger.warn("workload.backup.disabled", {
			hint: "set TENANT_BACKUP_BUCKET, TENANT_BACKUP_ENDPOINT, TENANT_BACKUP_ACCESS_KEY_ID, TENANT_BACKUP_SECRET_ACCESS_KEY",
		});
	}

	const tenantCache = new TenantCache({
		load: (accountId) => getTenant(db, accountId),
		readToken: (accountId) => {
			const acct8 = acct8For(accountId);
			const contents = readFileSync(join(secretsRoot, acct8, ".env"), "utf8");
			const match = contents.match(/^INSTANCE_TOKEN=(.+)$/m);
			if (!match) throw new Error(`no INSTANCE_TOKEN for tenant-${acct8}`);
			return match[1] ?? "";
		},
	});

	const stackState = createStackStateReporter(db, {
		appServerUrl,
		workloadHostKey,
	});

	const provisionerCfg: ProvisionerConfig = {
		db,
		secretsRoot,
		composeFile,
		hostedApiUrl: appServerUrl,
		workloadHostKey,
		backups,
		getTargetSha: () => targetShaCache.lastGood,
		getTargetSequence: () => targetShaCache.sequence ?? null,
		testnetStack: testnetStackFromEnv(process.env),
		onTenantChanged: (accountId) => {
			tenantCache.invalidate(accountId);
			stackState.schedule(accountId);
		},
	};
	const upgradeRunner = createUpgradeRunner(provisionerCfg);
	const processorDeps = realProcessorWatchDeps(provisionerCfg);
	const processorReconciler = createProcessorReconciler(
		provisionerCfg,
		processorDeps,
	);
	const checkProcessors = createProcessorWatch(
		provisionerCfg,
		{
			...processorDeps,
			onStopped: createStoppedReporter({ appServerUrl, workloadHostKey }),
		},
		processorReconciler,
	);

	// Before the gateway accepts requests: a restart mid-provision leaves
	// `provisioning` rows nothing will ever finish. Failure here must not
	// block boot.
	try {
		const recovered = await recoverInterruptedProvisions(provisionerCfg);
		if (recovered > 0) {
			logger.warn("workload.provisioner.recovered_interrupted_total", {
				count: recovered,
			});
		}
	} catch (err) {
		logger.error("workload.provisioner.recover_interrupted_failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Tell the platform where every stack stands now, so it does not wait a
	// poll interval after a deploy. Never blocks boot.
	void stackState.reconcile();

	// One EventCounter + meter-socket server per running tenant, started at
	// boot, on every sampler tick, and on a gateway request. Keyed by
	// accountId, not acct8, so a lookup never needs the derivation twice.
	const meterSockets = createMeterSocketRegistry({
		socketPathFor: (accountId) =>
			join(secretsRoot, acct8For(accountId), "sockets", "meter.sock"),
	});
	try {
		meterSockets.sync(
			(await listRunningTenants(db)).map((tenant) => tenant.account_id),
		);
	} catch (err) {
		logger.error("workload.meters.socket_boot_sync_failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	/** Loopback-only: the gateway is a host process with no compose-network
	 *  DNS (review fix 1 — `tenant-<acct8>-api` never resolved from here).
	 *  `api_port` comes from the control DB (allocated once, at insert,
	 *  never reused); `INSTANCE_TOKEN` from that tenant's own secrets file
	 *  (never the control DB, which holds no secrets). */
	async function tenantUpstream(
		accountId: string,
	): Promise<{ baseUrl: string; instanceToken: string }> {
		const row = await tenantCache.row(accountId);
		if (!row) throw new Error(`no tenant row for ${accountId}`);
		return {
			baseUrl: `http://127.0.0.1:${row.api_port}`,
			instanceToken: tenantCache.token(accountId),
		};
	}

	const workloadSha = resolveWorkloadSha();

	const server = Bun.serve({
		port: gatewayPort,
		hostname: "127.0.0.1",
		// Bun's default idleTimeout is 10s, which closes any proxied call that
		// takes longer to answer (a delete waiting on a reindex runner, a deploy
		// with a large bundle). Stay above the tenant API's own 90s so the tenant
		// is always the one to time out, never the gateway.
		idleTimeout: 120,
		fetch: (req) =>
			handleGatewayRequest(
				{
					introspect,
					recordFailure: failedRequests.record,
					resolveTenant: async (accountId) => {
						const row = await tenantCache.row(accountId);
						if (row) meterSockets.ensure(accountId);
						return row?.state;
					},
					stopReason: async (accountId) =>
						(await tenantCache.row(accountId))?.stop_reason ?? null,
					startProvisioning: (accountId) => {
						provisionUp(provisionerCfg, accountId)
							.then(() => meterSockets.ensure(accountId))
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
					onSubgraphDeployed: (accountId) => {
						processorReconciler.reconcileAccount(accountId).catch((err) => {
							logger.error("workload.processor.reconcile_failed", {
								accountId,
								error: err instanceof Error ? err.message : String(err),
							});
						});
					},
					rateLimit,
					testnetAccountId: provisionerCfg.testnetStack?.accountId,
					sha: workloadSha,
					isBusy: upgradeRunner.isBusy,
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
	// Windows start at boot, so a restart in the same minute never reuses the
	// previous process's keys.
	const eventWindow = new DrainWindow();
	const eventFlushTick = skipWhileRunning(
		async () => {
			// One window for the whole tick: every counter drained this pass is
			// keyed and dated by it, so a batch that fails to flush and gets
			// resent later keeps its real window.
			const window = eventWindow.roll();
			const fresh: MeterBatchItem[] = [];
			for (const [accountId, counter] of meterSockets.counters) {
				const item = eventsMeterItem(accountId, counter.drain(), window);
				if (item) fresh.push(item);
			}
			const { items, dropped } = mergePending(
				eventPending,
				fresh,
				DEFAULT_PENDING_CAP,
			);
			logDroppedMeters("pending_overflow:events", dropped);
			eventPending = await flushAll(
				{ appServerUrl, workloadHostKey },
				items,
				MAX_METER_BATCH,
			);
		},
		() => logger.warn("workload.meters.event_flush_skipped_overlap"),
	);
	const eventFlushLoop = setInterval(eventFlushTick, METER_FLUSH_INTERVAL_MS);

	// Memory meter (review fix 4): sample every 60s, accumulate GB-hours per
	// account, flush hourly. `runningTenants` re-lists every tick so a
	// newly-running or newly-stopped tenant is picked up/dropped without a
	// restart.
	const memoryAccumulator = new MemoryAccumulator();
	const memorySampleLoop = setInterval(
		createMemorySampleTick({
			listRunning: () => listRunningTenants(db),
			sampleBytes: (accountId) => sampleTenantMemoryBytes(acct8For(accountId)),
			accumulator: memoryAccumulator,
			onRunning: (accountIds) => meterSockets.sync(accountIds),
			onSkip: () =>
				logger.warn("workload.meters.memory_sample_skipped_overlap"),
		}),
		MEMORY_SAMPLE_INTERVAL_MS,
	);

	let memoryPending: MeterBatchItem[] = [];
	const memoryFlushTick = skipWhileRunning(
		async () => {
			const fresh = memoryAccumulator.drain();
			const { items, dropped } = mergePending(
				memoryPending,
				fresh,
				DEFAULT_PENDING_CAP,
			);
			logDroppedMeters("pending_overflow:memory", dropped);
			memoryPending = await flushAll(
				{ appServerUrl, workloadHostKey },
				items,
				MAX_METER_BATCH,
			);
		},
		() => logger.warn("workload.meters.memory_flush_skipped_overlap"),
	);
	const memoryFlushLoop = setInterval(
		memoryFlushTick,
		MEMORY_FLUSH_INTERVAL_MS,
	);

	// Storage meter + nightly backups: short ticks that do the work when a
	// tenant's last-done marker in the control DB is older than the current UTC
	// day, so a restart neither skips a day nor repeats one. Each also runs once
	// at boot.
	const storageSample = createStorageSampleTick({
		db,
		sampleBytes: (accountId) => sampleTenantDatabaseBytes(acct8For(accountId)),
		flush: (items) =>
			flushAll({ appServerUrl, workloadHostKey }, items, MAX_METER_BATCH),
		onSkip: () => logger.warn("workload.meters.storage_tick_skipped_overlap"),
	});
	void storageSample.tick();
	const storageLoop = setInterval(storageSample.tick, DAILY_JOB_TICK_MS);

	// Backups cover every running or stopped tenant (a stopped stack keeps its
	// postgres), then the 30-day sweep of destroy-time dumps.
	const backupTick = backups
		? createBackupTick({
				db,
				backups,
				backup: backupTenant,
				pruneFinal: pruneFinalBackups,
				onSkip: () => logger.warn("workload.backup.tick_skipped_overlap"),
			})
		: null;
	if (backupTick) void backupTick();
	const backupLoop = backupTick
		? setInterval(backupTick, DAILY_JOB_TICK_MS)
		: null;

	// Zero-balance / top-up poll (review fix 3a): running→stopped,
	// stopped→running, every 5 minutes (Design). Piggybacks the target-sha
	// resolution + rolling upgrade (plan 064) on the same interval — simpler
	// than a second timer, and both are 5-minute-cadence background sweeps
	// over the same tenant set.
	// `setInterval` doesn't wait for an async tick: a slow round must not
	// overlap the next one (two rounds would stop/start the same tenants).
	const creditsPollTick = skipWhileRunning(
		async () => {
			const targetSha = await resolveTargetSha(
				appServerUrl,
				fetch,
				targetShaCache,
			);
			if (targetSha) {
				await upgradeRunner.run(targetSha).catch((err) => {
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
			await checkProcessors().catch((err) => {
				logger.error("workload.processor.watch_failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			});
			// After the poll and watch above have moved tenants. A failed report
			// is retried by the next tick's full reconcile.
			await stackState.reconcile();
		},
		() => logger.warn("workload.credits_poll.skipped_overlap"),
	);
	const creditsPollLoop = setInterval(
		creditsPollTick,
		CREDITS_POLL_INTERVAL_MS,
	);

	// Webhook outage emails: read each tenant's webhooks over loopback and
	// report to the platform, which debounces and sends. Tenants never hold
	// the workload host key.
	const checkWebhookIncidents = createWebhookIncidentWatch(provisionerCfg, {
		appServerUrl,
		workloadHostKey,
	});
	const webhookIncidentLoop = setInterval(() => {
		checkWebhookIncidents().catch((err) => {
			logger.error("workload.webhook_incidents.tick_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}, WEBHOOK_INCIDENT_INTERVAL_MS);

	// Phone pushes for replays that finished: same loopback read as above, one
	// internal route on the platform that builds the copy and debounces.
	const checkPushWatch = createPushWatch(provisionerCfg, {
		appServerUrl,
		workloadHostKey,
	});
	const pushWatchLoop = setInterval(() => {
		checkPushWatch().catch((err) => {
			logger.error("workload.push_watch.tick_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}, PUSH_WATCH_INTERVAL_MS);

	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return; // a second SIGINT/SIGTERM must not re-enter the flush
		shuttingDown = true;
		logger.info("workload host shutting down");
		clearInterval(eventFlushLoop);
		clearInterval(memorySampleLoop);
		clearInterval(memoryFlushLoop);
		clearInterval(storageLoop);
		if (backupLoop) clearInterval(backupLoop);
		clearInterval(creditsPollLoop);
		clearInterval(webhookIncidentLoop);
		clearInterval(pushWatchLoop);
		stackState.stop();
		await stopFailedRequests();
		// Before anything else stops: a tenant upgrade round is a child
		// `docker compose up`; letting it finish avoids a half-recreated stack.
		if (!(await upgradeRunner.drain(UPGRADE_DRAIN_MS))) {
			logger.warn("workload.upgrade.drain_timeout", {
				timeoutMs: UPGRADE_DRAIN_MS,
			});
		}
		meterSockets.stopAll();
		server.stop();

		// Final flush: drains each meter's live accumulator (an EventCounter's
		// in-flight minute, memory's in-flight hour) plus whatever's already
		// sitting in a pending retry buffer, so a restart never under-bills —
		// bounded so a dead app-server can't delay exit past the timeout.
		const items = collectShutdownFlushItems({
			eventCounters: meterSockets.counters,
			eventWindow,
			eventPending,
			memory: memoryAccumulator,
			memoryPending,
			storagePending: storageSample.pending(),
		});
		await flushOnShutdown(
			{ appServerUrl, workloadHostKey },
			items,
			MAX_METER_BATCH,
			SHUTDOWN_FLUSH_TIMEOUT_MS,
		);

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
