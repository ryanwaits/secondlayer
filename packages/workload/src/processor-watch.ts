/**
 * Watches each running tenant's `subgraph-processor` for the two ways
 * customer handler code can wedge it. The runner only counts THROWN errors
 * (`DEFAULT_ERROR_THRESHOLD`), so neither shows up there:
 *
 *   - Death: the container crashed or hit its memory limit and was killed.
 *     Docker's own restart policy brings it back, and after that restart the
 *     `OOMKilled` flag reads false again, so a death is detected from the
 *     container's `RestartCount` rising between ticks (or a fresh OOM kill).
 *     The watchdog does not restart a dead processor; docker already did.
 *   - Stall: a synchronous `while (true) {}` blocks the processor's event
 *     loop, so a subgraph's cursor stops moving while the hosted tip keeps
 *     advancing. Only this case is restarted by the watchdog.
 *
 * Both `active` and `reindexing` subgraphs are tracked (a reindex is the usual
 * OOM victim); its cursor is the subgraph's `lastProcessedBlock`, which a
 * reindex advances. A reindex still waiting in the queue is not running, so it
 * is never blamed. After `MAX_RESTARTS_PER_HEIGHT` deaths at the same cursor
 * height the subgraph is marked `error` through the tenant's own api (instance
 * token, loopback): customer code doesn't get to report its own health, and
 * the processor skips non-`active` subgraphs, so that ends the loop. Events
 * are logged with tenant + subgraph name, never handler output.
 *
 * State lives in memory. A host restart loses it, which only delays the next
 * decision by one stall window.
 *
 * The same tick also reconciles whether the processor runs at all
 * (`createProcessorReconciler`): a tenant with no subgraphs runs without one
 * and bills the lower stack floor.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@secondlayer/shared";
import { billingPausedCode } from "@secondlayer/shared/schemas";
import {
	getTenant,
	listRunningTenants,
	setTenantHasSubgraphs,
} from "./control-db.ts";
import type { TenantRow } from "./control-db.ts";
import { type RunDocker, spawnDocker } from "./meters.ts";
import {
	type ProvisionerConfig,
	type RunCompose,
	composeEnv,
	parseEnvFile,
	projectName,
	spawnCompose,
	tenantDir,
} from "./provisioner.ts";

/** A cursor that hasn't moved for this long while the hosted tip has is stalled. */
export const STALL_MS = 10 * 60_000;
export const MAX_RESTARTS_PER_HEIGHT = 3;
/**
 * How far a cursor may drift between deaths and still count as "the same
 * place". Progress is flushed every 100 blocks or 5s, so a processor that dies
 * in the same dense batch each time creeps forward a little per attempt. One
 * max reindex batch (1,000 blocks): past it the subgraph got somewhere new.
 */
export const CURSOR_CREEP_MARGIN = 1_000;

export interface SubgraphCursor {
	name: string;
	status: string;
	lastProcessedBlock: number;
	/** A reindex that is queued behind another operation rather than running. */
	queued?: boolean;
	/** Latest indexing error. `billing_paused: <code>` means the account's
	 *  metered reads are refused (spend cap / credits): a deliberate pause. */
	lastError?: string | null;
}

const isBillingPaused = (sub: SubgraphCursor): boolean =>
	billingPausedCode(sub.lastError) !== null;

/** A hosted subgraph went from running to stopped. Push-only (plan 309); never an insight. */
export interface SubgraphStoppedEvent {
	accountId: string;
	subgraph: string;
	/** `error`: the subgraph's own status flipped to `error` (handler errors past the runner's threshold, or another halt). */
	reason: "out_of_memory" | "crashed" | "stalled" | "error";
	/** Cursor when it stopped. */
	height: number;
	lastError: string | null;
	at: number;
}

/** What `docker inspect` says about the processor container. */
export interface ProcessorState {
	/** Restarts performed by docker's restart policy since the container was created. */
	restartCount: number;
	oomKilled: boolean;
	/** Exit code of the last run (137 = SIGKILL, what the OOM killer sends). */
	exitCode: number;
	finishedAt: string;
}

export interface ProcessorWatchDeps {
	/** The processor container's restart/exit state, or `null` when it doesn't exist. */
	inspectProcessor: (acct8: string) => Promise<ProcessorState | null>;
	listSubgraphs: (tenant: TenantEndpoint) => Promise<SubgraphCursor[]>;
	haltSubgraph: (
		tenant: TenantEndpoint,
		name: string,
		reason: string,
	) => Promise<void>;
	/** Hosted chain tip; `null` when unknown (stall detection then waits). */
	hostedTip: () => Promise<number | null>;
	restartProcessor: (tenant: TenantRow) => Promise<boolean>;
	/** Creates and starts the processor for a tenant that just got subgraphs. */
	startProcessor: (tenant: TenantRow) => Promise<boolean>;
	/** Stops and removes the processor for a tenant with no subgraphs left. */
	removeProcessor: (tenant: TenantRow) => Promise<boolean>;
	now: () => number;
	/** Fires once per stop. Optional; defaults to a no-op. Must not throw into the watch. */
	onStopped?: (event: SubgraphStoppedEvent) => void | Promise<void>;
}

export interface TenantEndpoint {
	baseUrl: string;
	instanceToken: string;
}

interface Tracker {
	/** Cursor as of the latest tick. */
	height: number;
	/** When `height` last changed. */
	movedAt: number;
	/** Hosted tip at that moment. */
	tipAtMove: number | null;
	/** How far the cursor moved since the previous tick; `null` on first sight. */
	creep: number | null;
	/** Consecutive processor deaths (or watchdog restarts) near one cursor:
	 *  `count` of them, none past `highWater` + `CURSOR_CREEP_MARGIN`. */
	streak: { count: number; highWater: number } | null;
}

/** The container name compose gives the processor (project `tenant-<acct8>`). */
function processorContainer(acct8: string): string {
	return `tenant-${acct8}-subgraph-processor-1`;
}

export function tenantEndpoint(
	cfg: ProvisionerConfig,
	tenant: TenantRow,
): TenantEndpoint | null {
	try {
		const env = parseEnvFile(
			readFileSync(join(tenantDir(cfg, tenant.acct8), ".env"), "utf8"),
		);
		if (!env.INSTANCE_TOKEN) return null;
		return {
			baseUrl: `http://127.0.0.1:${tenant.api_port}`,
			instanceToken: env.INSTANCE_TOKEN,
		};
	} catch {
		return null;
	}
}

/** Real dependencies: `docker inspect`, the tenant api over loopback, the
 *  hosted tip over HTTP, and `docker compose restart`. */
export function realProcessorWatchDeps(
	cfg: ProvisionerConfig,
	opts: {
		runDocker?: RunDocker;
		runCompose?: RunCompose;
		fetchImpl?: typeof fetch;
	} = {},
): ProcessorWatchDeps {
	const runDocker = opts.runDocker ?? spawnDocker;
	const runCompose = opts.runCompose ?? cfg.runCompose ?? spawnCompose;
	const doFetch = opts.fetchImpl ?? fetch;
	const authed = (t: TenantEndpoint) => ({
		authorization: `Bearer ${t.instanceToken}`,
	});
	/** One compose call on the processor. Compose interpolates the whole file,
	 *  so it needs SOME image tag; the one this tenant already runs keeps a
	 *  started processor on the same image as the rest of its stack. */
	async function processorCompose(
		tenant: TenantRow,
		args: string[],
	): Promise<boolean> {
		const tag = tenant.image_sha ?? cfg.getTargetSha();
		if (!tag) return false;
		const res = await runCompose(
			[
				"-p",
				projectName(tenant.acct8),
				"-f",
				cfg.composeFile,
				"--env-file",
				join(tenantDir(cfg, tenant.acct8), ".env"),
				...args,
			],
			composeEnv(tag, true),
		);
		return res.code === 0;
	}

	return {
		inspectProcessor: async (acct8) => {
			const res = await runDocker([
				"inspect",
				"--format",
				"{{.RestartCount}} {{.State.OOMKilled}} {{.State.ExitCode}} {{.State.FinishedAt}}",
				processorContainer(acct8),
			]);
			if (res.code !== 0) return null;
			const [restarts, oom, exit, finishedAt] = res.stdout.trim().split(" ");
			return {
				restartCount: Number(restarts) || 0,
				oomKilled: oom === "true",
				exitCode: Number(exit) || 0,
				finishedAt: finishedAt ?? "",
			};
		},
		listSubgraphs: async (tenant) => {
			const res = await doFetch(`${tenant.baseUrl}/api/subgraphs`, {
				headers: authed(tenant),
			});
			if (!res.ok) throw new Error(`list subgraphs failed: ${res.status}`);
			const body = (await res.json()) as { data?: SubgraphCursor[] };
			const rows = body.data ?? [];
			// The list can't tell a running reindex from one waiting its turn
			// (both read `reindexing`), and a queued one's cursor is frozen by
			// design. Only the detail response carries the queue position.
			return Promise.all(
				rows.map(async (row) => {
					if (row.status !== "reindexing") return row;
					const detail = await doFetch(
						`${tenant.baseUrl}/api/subgraphs/${encodeURIComponent(row.name)}`,
						{ headers: authed(tenant) },
					);
					if (!detail.ok) return row;
					const info = (await detail.json()) as { sync?: { queue?: unknown } };
					return { ...row, queued: Boolean(info.sync?.queue) };
				}),
			);
		},
		haltSubgraph: async (tenant, name, reason) => {
			const res = await doFetch(
				`${tenant.baseUrl}/api/subgraphs/${encodeURIComponent(name)}/halt`,
				{
					method: "POST",
					headers: { ...authed(tenant), "content-type": "application/json" },
					body: JSON.stringify({ reason }),
				},
			);
			if (!res.ok) throw new Error(`halt subgraph failed: ${res.status}`);
		},
		hostedTip: async () => {
			try {
				const res = await doFetch(
					`${cfg.hostedApiUrl.replace(/\/+$/, "")}/v1/streams/tip`,
					{ headers: { authorization: "Bearer sk-sl_streams_status_public" } },
				);
				if (!res.ok) return null;
				const body = (await res.json()) as { block_height?: number };
				return typeof body.block_height === "number" ? body.block_height : null;
			} catch {
				return null;
			}
		},
		restartProcessor: async (tenant) =>
			processorCompose(tenant, ["restart", "subgraph-processor"]),
		startProcessor: async (tenant) =>
			processorCompose(tenant, [
				"up",
				"-d",
				"--wait",
				"--no-deps",
				"subgraph-processor",
			]),
		removeProcessor: async (tenant) =>
			(await processorCompose(tenant, ["stop", "subgraph-processor"])) &&
			(await processorCompose(tenant, ["rm", "-f", "subgraph-processor"])),
		now: () => Date.now(),
	};
}

export interface ProcessorReconciler {
	/** Makes the processor match the subgraph count: runs it when `count > 0`,
	 *  removes it at 0, and keeps `has_subgraphs` (the floor) in step.
	 *  Returns whether a processor exists afterwards. */
	reconcile: (
		tenant: TenantRow,
		subgraphCount: number,
		processorExists: boolean,
	) => Promise<boolean>;
	/** Same for one account, reading its subgraphs and processor itself: the
	 *  gateway calls this after a deploy so the first one doesn't wait a tick. */
	reconcileAccount: (accountId: string) => Promise<void>;
}

/**
 * Raises `has_subgraphs` before starting a processor and lowers it only
 * after the processor is gone, so the $5 webhook-only floor never applies
 * while a processor runs. A failed stop keeps the flag (and the $10 floor)
 * until a later tick succeeds. One reconcile per account at a time.
 */
export function createProcessorReconciler(
	cfg: ProvisionerConfig,
	deps: ProcessorWatchDeps,
): ProcessorReconciler {
	const inFlight = new Set<string>();

	async function reconcile(
		tenant: TenantRow,
		subgraphCount: number,
		processorExists: boolean,
	): Promise<boolean> {
		if (inFlight.has(tenant.account_id)) return processorExists;
		inFlight.add(tenant.account_id);
		try {
			if (subgraphCount > 0) {
				if (!tenant.has_subgraphs) {
					await setTenantHasSubgraphs(cfg.db, tenant.account_id, true);
				}
				if (processorExists) return true;
				const ok = await deps.startProcessor({
					...tenant,
					has_subgraphs: true,
				});
				logger.info("workload.processor.started", {
					accountId: tenant.account_id,
					acct8: tenant.acct8,
					ok,
				});
				return ok;
			}
			if (processorExists) {
				const ok = await deps.removeProcessor(tenant);
				if (!ok) {
					logger.warn("workload.processor.remove_failed", {
						accountId: tenant.account_id,
						acct8: tenant.acct8,
					});
					return true;
				}
				logger.info("workload.processor.removed", {
					accountId: tenant.account_id,
					acct8: tenant.acct8,
				});
			}
			if (tenant.has_subgraphs) {
				await setTenantHasSubgraphs(cfg.db, tenant.account_id, false);
			}
			return false;
		} finally {
			inFlight.delete(tenant.account_id);
		}
	}

	return {
		reconcile,
		reconcileAccount: async (accountId) => {
			const tenant = await getTenant(cfg.db, accountId);
			if (tenant?.state !== "running") return;
			const endpoint = tenantEndpoint(cfg, tenant);
			if (!endpoint) return;
			const subgraphs = await deps.listSubgraphs(endpoint);
			const container = await deps.inspectProcessor(tenant.acct8);
			await reconcile(tenant, subgraphs.length, container !== null);
		},
	};
}

/**
 * One check over every running tenant. Returns the per-tick function the
 * 5-minute loop calls. Never throws: one tenant's failure is logged and the
 * rest are still checked.
 */
export function createProcessorWatch(
	cfg: ProvisionerConfig,
	deps: ProcessorWatchDeps = realProcessorWatchDeps(cfg),
	reconciler: ProcessorReconciler = createProcessorReconciler(cfg, deps),
): () => Promise<void> {
	const trackers = new Map<string, Tracker>();
	/** `FinishedAt` of the last OOM kill already counted, per account, so a
	 *  sticky `OOMKilled` flag can't count the same death every tick. */
	const handledOom = new Map<string, string>();
	/** Docker's `RestartCount` as of the previous tick, per account. */
	const lastRestartCount = new Map<string, number>();
	/** Each subgraph's status as of the previous tick; a stop is the move to `error`. */
	const lastStatus = new Map<string, string>();

	async function emitStopped(event: SubgraphStoppedEvent): Promise<void> {
		try {
			await deps.onStopped?.(event);
		} catch (err) {
			logger.warn("workload.processor.stopped_notify_failed", {
				accountId: event.accountId,
				subgraph: event.subgraph,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async function checkTenant(
		tenant: TenantRow,
		tip: number | null,
	): Promise<void> {
		const endpoint = tenantEndpoint(cfg, tenant);
		if (!endpoint) return;
		const now = deps.now();

		const listed = await deps.listSubgraphs(endpoint);
		let container = await deps.inspectProcessor(tenant.acct8);
		const processorExists = await reconciler.reconcile(
			tenant,
			listed.length,
			container !== null,
		);
		// Just removed: nothing left to watch. Just started: a fresh container.
		if (!processorExists) container = null;

		// A subgraph turning `error` is a stop. First sight and billing pauses
		// (a deliberate stop) never fire; a watchdog halt records `error` itself.
		const listedKeys = new Set<string>();
		for (const sub of listed) {
			const key = `${tenant.account_id}:${sub.name}`;
			listedKeys.add(key);
			const prev = lastStatus.get(key);
			if (
				prev !== undefined &&
				prev !== "error" &&
				sub.status === "error" &&
				!isBillingPaused(sub)
			) {
				await emitStopped({
					accountId: tenant.account_id,
					subgraph: sub.name,
					reason: "error",
					height: sub.lastProcessedBlock,
					lastError: sub.lastError ?? null,
					at: now,
				});
			}
			lastStatus.set(key, sub.status);
		}
		for (const key of lastStatus.keys()) {
			if (key.startsWith(`${tenant.account_id}:`) && !listedKeys.has(key)) {
				lastStatus.delete(key);
			}
		}

		const subgraphs = listed.filter(
			(s) => s.status === "active" || (s.status === "reindexing" && !s.queued),
		);
		const seen = new Set<string>();
		for (const sub of subgraphs) {
			const key = `${tenant.account_id}:${sub.name}`;
			seen.add(key);
			const tracker = trackers.get(key);
			if (isBillingPaused(sub)) {
				// A billing pause freezes the cursor on purpose while the tip moves.
				// Keep the stall clock fresh so the first tick after the pause ends
				// doesn't read the old freeze as a stall.
				trackers.set(key, {
					height: sub.lastProcessedBlock,
					movedAt: now,
					tipAtMove: tip,
					creep: null,
					streak: tracker?.streak ?? null,
				});
			} else if (!tracker) {
				trackers.set(key, {
					height: sub.lastProcessedBlock,
					movedAt: now,
					tipAtMove: tip,
					creep: null,
					streak: null,
				});
			} else {
				tracker.creep = Math.abs(sub.lastProcessedBlock - tracker.height);
				if (tracker.height !== sub.lastProcessedBlock) {
					tracker.height = sub.lastProcessedBlock;
					tracker.movedAt = now;
					tracker.tipAtMove = tip;
				}
			}
		}
		for (const key of trackers.keys()) {
			if (key.startsWith(`${tenant.account_id}:`) && !seen.has(key)) {
				trackers.delete(key);
			}
		}

		let deaths = 0;
		let oom = false;
		if (container) {
			// A recreated container (an upgrade) restarts the count from zero.
			const previous = lastRestartCount.get(tenant.account_id);
			const restartDelta =
				previous === undefined
					? 0
					: Math.max(0, container.restartCount - previous);
			lastRestartCount.set(tenant.account_id, container.restartCount);
			const newOom =
				container.oomKilled &&
				handledOom.get(tenant.account_id) !== container.finishedAt;
			if (newOom) handledOom.set(tenant.account_id, container.finishedAt);
			deaths = Math.max(restartDelta, newOom ? 1 : 0);
			oom = container.oomKilled || container.exitCode === 137;
		}

		const stalled = subgraphs.filter((sub) => {
			if (isBillingPaused(sub)) return false;
			const t = trackers.get(`${tenant.account_id}:${sub.name}`);
			return (
				t !== undefined &&
				tip !== null &&
				t.tipAtMove !== null &&
				tip > t.tipAtMove &&
				now - t.movedAt >= STALL_MS
			);
		});
		if (deaths === 0 && stalled.length === 0) return;

		// A stall names its subgraphs. A death doesn't, so blame only a subgraph
		// that is not keeping up: behind the hosted tip by more than the margin,
		// with a cursor that crept at most the margin since the last tick (the
		// same dense batch killing the processor again). One following the tip
		// moves tens of blocks per tick and is never to blame. With the tip
		// unknown, only a cursor that has not moved at all is blamed. If nobody
		// qualifies the death is recorded without a culprit.
		const culprits = stalled.length
			? stalled
			: subgraphs.filter((sub) => {
					if (isBillingPaused(sub)) return false;
					const creep = trackers.get(`${tenant.account_id}:${sub.name}`)?.creep;
					if (creep == null) return false;
					if (tip === null) return creep === 0;
					return (
						tip - sub.lastProcessedBlock > CURSOR_CREEP_MARGIN &&
						creep <= CURSOR_CREEP_MARGIN
					);
				});
		const reason = deaths > 0 ? (oom ? "out_of_memory" : "crashed") : "stalled";

		// Docker's restart policy already brought a dead processor back; only a
		// stall (a live but wedged process) needs the watchdog to restart it.
		let count = deaths;
		if (deaths > 0) {
			logger.warn("workload.processor.died", {
				accountId: tenant.account_id,
				reason,
				exitCode: container?.exitCode,
				deaths,
				subgraphs: culprits.map((s) => s.name),
			});
		} else {
			const restarted = await deps.restartProcessor(tenant);
			count = 1;
			logger.warn("workload.processor.restarted", {
				accountId: tenant.account_id,
				reason,
				ok: restarted,
				subgraphs: culprits.map((s) => s.name),
			});
		}

		for (const sub of culprits) {
			const tracker = trackers.get(`${tenant.account_id}:${sub.name}`);
			if (!tracker) continue;
			const cursor = sub.lastProcessedBlock;
			// Same streak while the cursor stays within the margin of the highest
			// cursor a death was counted at; past it, the subgraph moved on.
			const streak =
				tracker.streak &&
				cursor <= tracker.streak.highWater + CURSOR_CREEP_MARGIN
					? tracker.streak
					: { count: 0, highWater: cursor };
			streak.count += count;
			streak.highWater = Math.max(streak.highWater, cursor);
			tracker.streak = streak;
			if (streak.count < MAX_RESTARTS_PER_HEIGHT) continue;
			await deps.haltSubgraph(
				endpoint,
				sub.name,
				`Halted after ${streak.count} restarts at block ${cursor} (${reason}). Redeploy to resume.`,
			);
			trackers.delete(`${tenant.account_id}:${sub.name}`);
			logger.error("workload.processor.subgraph_halted", {
				accountId: tenant.account_id,
				subgraph: sub.name,
				height: cursor,
				reason,
			});
			lastStatus.set(`${tenant.account_id}:${sub.name}`, "error");
			await emitStopped({
				accountId: tenant.account_id,
				subgraph: sub.name,
				reason,
				height: cursor,
				lastError: null,
				at: now,
			});
		}
	}

	return async () => {
		const tenants = await listRunningTenants(cfg.db);
		if (tenants.length === 0) return;
		const tip = await deps.hostedTip();
		for (const tenant of tenants) {
			try {
				await checkTenant(tenant, tip);
			} catch (err) {
				logger.warn("workload.processor.check_failed", {
					accountId: tenant.account_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	};
}
