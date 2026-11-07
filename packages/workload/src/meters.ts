/**
 * Trusted-side meters (step 5, Design): the provisioner is the only thing
 * that measures a tenant's usage and the only thing that talks to
 * app-server's `POST /internal/meters` — a tenant's own containers never
 * see the workload host key.
 *
 * Three meters:
 *  - `webhook.event`: one push per tenant per minute over a unix socket
 *    mounted ONLY into that tenant's `webhook-service` (never `api`, so
 *    046's customer-deployed handlers can't reach it or lower the count).
 *  - `memory.gb_hour`: `docker stats` (cgroup RSS) per tenant, sampled here
 *    and accumulated into GB-seconds, flushed hourly.
 *  - `storage.gb_day`: `pg_database_size`, sampled here as admin once a day.
 *
 * All three funnel through `flushMeterBatch`, batched. Memory and event keys
 * name the accumulation window they cover (`[start, end)`), so a re-sent
 * batch (a crashed flush retried) never double-charges, and two flushes in
 * the same hour or minute (a restart) never share a key and drop the second.
 */

import { rmSync } from "node:fs";
import {
	type MeterUnit,
	stackMemoryFloorGb,
} from "@secondlayer/platform/billing/prices";
import { logger } from "@secondlayer/shared";
import type { FetchLike } from "./fetch-like.ts";

export interface MeterBatchItem {
	accountId: string;
	unit: MeterUnit;
	quantity: number;
	/** Raw sampled quantity before any floor — `memory.gb_hour` only. Passed
	 *  through to `/internal/meters` and stored on the ledger row unchanged;
	 *  pricing never reads it. */
	observedQuantity?: number;
	idempotencyKey: string;
	occurredAt?: string;
}

/** `storage:<account>:<yyyy-mm-dd>` (Design) — one row per tenant per day.
 *  Storage is a point-in-time sample, not an accumulation, so a second
 *  same-day sample being a no-op is intended. */
export function storageIdempotencyKey(accountId: string, at: Date): string {
	return `storage:${accountId}:${at.toISOString().slice(0, 10)}`;
}

/** The half-open span `[start, end)` an accumulated meter item covers. */
export interface MeterWindow {
	start: Date;
	end: Date;
}

function windowKey(
	prefix: "mem" | "evt",
	accountId: string,
	window: MeterWindow,
): string {
	return `${prefix}:${accountId}:${window.start.toISOString()}..${window.end.toISOString()}`;
}

/** `mem:<account>:<startISO>..<endISO>` — one row per tenant per
 *  accumulation window. Every window starts at process boot or the previous
 *  flush's end (ms precision), so two processes in the same hour never
 *  share a key, and none can equal an old `mem:<account>:<yyyy-mm-ddThh>`
 *  key (the `..` span never matches an hour string). */
export function memoryWindowKey(
	accountId: string,
	window: MeterWindow,
): string {
	return windowKey("mem", accountId, window);
}

/** `evt:<account>:<startISO>..<endISO>` — same window rule as memory: a
 *  same-minute restart can no longer reuse the previous flush's key. */
export function eventsWindowKey(
	accountId: string,
	window: MeterWindow,
): string {
	return windowKey("evt", accountId, window);
}

/** Tracks where the next accumulation window starts. Created at process
 *  boot, so a window never reaches back before this process's own
 *  measurements; `roll` closes the current window and opens the next one at
 *  the same instant, so consecutive windows tile with no gap or overlap. */
export class DrainWindow {
	private start: Date;

	constructor(startedAt: Date = new Date()) {
		this.start = startedAt;
	}

	roll(now: Date = new Date()): MeterWindow {
		const end = now.getTime() < this.start.getTime() ? this.start : now;
		const window = { start: this.start, end };
		this.start = end;
		return window;
	}
}

/** GB-hours accumulated per tenant since the last drain. The sampler adds;
 *  the hourly flush and the shutdown flush both `drain`, so each item is
 *  keyed by the window it actually covers. */
export class MemoryAccumulator {
	private readonly gbHours = new Map<string, number>();
	private readonly observedGbHours = new Map<string, number>();
	private readonly window: DrainWindow;

	constructor(startedAt: Date = new Date()) {
		this.window = new DrainWindow(startedAt);
	}

	add(accountId: string, gbHours: number, observedGbHours: number): void {
		this.gbHours.set(accountId, (this.gbHours.get(accountId) ?? 0) + gbHours);
		this.observedGbHours.set(
			accountId,
			(this.observedGbHours.get(accountId) ?? 0) + observedGbHours,
		);
	}

	/** One item per account with a positive total, then reset. */
	drain(now: Date = new Date()): MeterBatchItem[] {
		const window = this.window.roll(now);
		const items: MeterBatchItem[] = [];
		for (const [accountId, gbHours] of this.gbHours) {
			if (gbHours <= 0) continue;
			items.push({
				accountId,
				unit: "memory.gb_hour",
				quantity: gbHours,
				observedQuantity: this.observedGbHours.get(accountId),
				idempotencyKey: memoryWindowKey(accountId, window),
				// Dated at the window end, so a retried item keeps the hour it
				// was measured in.
				occurredAt: window.end.toISOString(),
			});
		}
		this.gbHours.clear();
		this.observedGbHours.clear();
		return items;
	}
}

export interface MetersClientConfig {
	appServerUrl: string;
	workloadHostKey: string;
	fetchImpl?: FetchLike;
}

/** POST one batch to `/internal/meters`. Empty batches are a no-op — never
 *  worth a round trip. */
export async function flushMeterBatch(
	cfg: MetersClientConfig,
	items: MeterBatchItem[],
): Promise<void> {
	if (items.length === 0) return;
	const doFetch = cfg.fetchImpl ?? fetch;
	const res = await doFetch(
		`${cfg.appServerUrl.replace(/\/+$/, "")}/internal/meters`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${cfg.workloadHostKey}`,
			},
			body: JSON.stringify({ items }),
		},
	);
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`meters flush failed: ${res.status} ${text.slice(0, 500)}`);
	}
}

/**
 * Per-tenant delivered-event counter, fed by a unix-socket HTTP server
 * (`Bun.serve({ unix })`) bind-mounted into that tenant's `webhook-service`
 * only (`docker/workload/tenant.compose.yml`'s `TENANT_SOCKET_DIR`). Counts
 * accumulate in memory here and are drained by the caller's flush loop —
 * they never touch the tenant's own Postgres, so customer code (once 046
 * lands) can't lower them.
 */
export class EventCounter {
	private count = 0;

	/** Add `n` delivered events (never negative — a malformed push is
	 *  ignored, not subtracted). */
	add(n: number): void {
		if (Number.isFinite(n) && n > 0) this.count += Math.floor(n);
	}

	/** Read and zero the counter atomically (single-threaded JS — no lock
	 *  needed), so a flush never double-counts what it already sent. */
	drain(): number {
		const n = this.count;
		this.count = 0;
		return n;
	}
}

export interface MeterSocketServerHandle {
	stop: () => void;
}

/** Starts the unix-socket HTTP server for one tenant's event counter. Any
 *  POST body `{ "delivered_events": N }` adds `N` to `counter`; anything
 *  else (wrong method, bad body) is ignored, not fatal — a malformed push
 *  from a future webhook-service version should never crash the
 *  provisioner. */
export function startMeterSocketServer(
	socketPath: string,
	counter: EventCounter,
): MeterSocketServerHandle {
	const server = Bun.serve({
		unix: socketPath,
		fetch: async (req) => {
			if (req.method !== "POST") {
				return new Response("method not allowed", { status: 405 });
			}
			const body = (await req.json().catch(() => null)) as {
				delivered_events?: number;
			} | null;
			if (typeof body?.delivered_events === "number") {
				counter.add(body.delivered_events);
			}
			return new Response("ok");
		},
	});
	return { stop: () => server.stop(true) };
}

export interface MeterSocketRegistry {
	/** A counter exists only for a tenant whose socket server is up. */
	readonly counters: Map<string, EventCounter>;
	/** The tenant's counter, starting its socket server on first call; `undefined`
	 *  when the server could not start (retried by the next call). */
	ensure(accountId: string): EventCounter | undefined;
	/** `ensure` for every running tenant, then check the gauge. */
	sync(runningAccountIds: readonly string[]): void;
	/** Running tenants vs socket servers up among them, as of the last `sync`. */
	gauge(): { running: number; servers: number };
	/** Stops every server; counters stay readable for the final flush. */
	stopAll(): void;
}

/** One EventCounter + socket server per tenant, keyed by account id. A tenant
 *  is cached only once its server is listening, so a failed start (socket dir
 *  not created yet) is retried by the next `ensure`/`sync` instead of leaving
 *  a counter nothing can ever push to. A leftover socket file from a previous
 *  process is unlinked before binding. */
export function createMeterSocketRegistry(opts: {
	socketPathFor: (accountId: string) => string;
	start?: typeof startMeterSocketServer;
}): MeterSocketRegistry {
	const start = opts.start ?? startMeterSocketServer;
	const counters = new Map<string, EventCounter>();
	const servers = new Map<string, MeterSocketServerHandle>();
	let running = new Set<string>();

	function ensure(accountId: string): EventCounter | undefined {
		const existing = counters.get(accountId);
		if (existing) return existing;
		const counter = new EventCounter();
		const socketPath = opts.socketPathFor(accountId);
		try {
			rmSync(socketPath, { force: true });
			servers.set(accountId, start(socketPath, counter));
		} catch (err) {
			logger.warn("workload.meters.socket_start_deferred", {
				accountId,
				error: err instanceof Error ? err.message : String(err),
			});
			return undefined;
		}
		counters.set(accountId, counter);
		return counter;
	}

	function gauge(): { running: number; servers: number } {
		let up = 0;
		for (const accountId of running) if (counters.has(accountId)) up++;
		return { running: running.size, servers: up };
	}

	return {
		counters,
		ensure,
		sync(runningAccountIds) {
			running = new Set(runningAccountIds);
			for (const accountId of running) ensure(accountId);
			const g = gauge();
			if (g.servers !== g.running) {
				logger.warn("workload.meters.socket_gauge_mismatch", g);
			}
		},
		gauge,
		stopAll() {
			// Counters stay: the shutdown flush still drains their last events.
			for (const s of servers.values()) s.stop();
			servers.clear();
		},
	};
}

export interface MemorySample {
	/** GB-hours for the sample interval, floored at the stack minimum. */
	quantity: number;
	/** The same interval at the raw, unfloored RSS. */
	observedQuantity: number;
}

/** One tenant's memory sample: RSS summed across its containers, in GiB.
 *  `sampleCgroupBytes` is injected so tests never shell out to `docker
 *  stats`; the real implementation lives in `index.ts` (needs the compose
 *  project name → container list mapping). `quantity` is floored at the
 *  stack's dollar minimum expressed in GB (`stackMemoryFloorGb`, founder
 *  2026-10-15: $5/mo webhook-only, $10/mo with subgraphs), so a running
 *  stack always bills at least that, even idling near 0. Only running
 *  tenants are sampled (`listRunningTenants`), so a stopped stack is never
 *  floored. `observedQuantity` carries the raw, unfloored sample for the
 *  credits page's memory chart. Samples go into a `MemoryAccumulator`,
 *  which owns the idempotency key and date of what actually gets flushed. */
export async function sampleMemoryGbHour(
	accountId: string,
	sampleCgroupBytes: (accountId: string) => Promise<number>,
	intervalSeconds: number,
	hasSubgraphs: boolean,
): Promise<MemorySample> {
	const bytes = await sampleCgroupBytes(accountId);
	const rawGb = bytes / 1024 ** 3;
	const gb = Math.max(rawGb, stackMemoryFloorGb(hasSubgraphs));
	return {
		quantity: gb * (intervalSeconds / 3600),
		observedQuantity: rawGb * (intervalSeconds / 3600),
	};
}

/** One tenant's storage sample, in GB-days (one row per calendar day —
 *  the idempotency key already makes repeated same-day samples a no-op
 *  update, so this can run more than once a day without over-billing). */
export async function sampleStorageGbDay(
	accountId: string,
	sampleDatabaseBytes: (accountId: string) => Promise<number>,
): Promise<MeterBatchItem> {
	const bytes = await sampleDatabaseBytes(accountId);
	const gb = bytes / 1024 ** 3;
	// Same fix as `sampleMemoryGbHour`: pin `occurredAt` to the sample time,
	// not whenever a retried flush happens to land.
	const now = new Date();
	return {
		accountId,
		unit: "storage.gb_day",
		quantity: gb,
		idempotencyKey: storageIdempotencyKey(accountId, now),
		occurredAt: now.toISOString(),
	};
}

/** One tenant's drained event count for `window`, keyed and dated by it. */
export function eventsMeterItem(
	accountId: string,
	count: number,
	window: MeterWindow,
): MeterBatchItem | undefined {
	if (count <= 0) return undefined;
	return {
		accountId,
		unit: "webhook.event",
		quantity: count,
		idempotencyKey: eventsWindowKey(accountId, window),
		occurredAt: window.end.toISOString(),
	};
}

export interface DockerResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type RunDocker = (args: string[]) => Promise<DockerResult>;

/** Real `docker` invocation for the memory/storage samplers below. */
export const spawnDocker: RunDocker = async (args) => {
	const proc = Bun.spawn(["docker", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code: exitCode, stdout, stderr };
};

/** Parse one `docker stats --format {{.MemUsage}}` value, e.g. `"239.3MiB"`
 *  or `"1.2GiB"`, to bytes. Docker's memory display is always binary units
 *  (Ki/Mi/Gi/Ti), confirmed against a live `docker stats` run (step 3's
 *  local two-tenant verify: `"42.45MiB / 15.66GiB"`). Returns 0 for
 *  anything unparseable rather than throwing — a format change upstream
 *  should degrade a sample to zero, not crash the meter loop. */
export function parseMemUsageToBytes(value: string): number {
	const match = value.trim().match(/^([\d.]+)\s*([KMGT]i?B)$/i);
	if (!match) return 0;
	const amount = Number(match[1]);
	const unit = (match[2] ?? "").toUpperCase();
	const multipliers: Record<string, number> = {
		B: 1,
		KB: 1000,
		MB: 1000 ** 2,
		GB: 1000 ** 3,
		TB: 1000 ** 4,
		KIB: 1024,
		MIB: 1024 ** 2,
		GIB: 1024 ** 3,
		TIB: 1024 ** 4,
	};
	const multiplier = multipliers[unit];
	if (!Number.isFinite(amount) || multiplier === undefined) return 0;
	return amount * multiplier;
}

/** Sum memory bytes across every line of a `docker stats --no-stream
 *  --format "{{.MemUsage}}"` run against one tenant's containers (one line
 *  per container: `api`, `webhook-service`, `postgres`, ...). Each line is
 *  `"<used> / <limit>"` — only `<used>` (before the ` / `) counts. */
export function parseDockerStatsMemUsageBytes(output: string): number {
	let total = 0;
	for (const line of output.split("\n")) {
		const used = line.split("/")[0]?.trim();
		if (!used) continue;
		total += parseMemUsageToBytes(used);
	}
	return total;
}

/** Real memory sample for one tenant: `docker ps` (by
 *  `com.docker.compose.project=tenant-<acct8>` — the label every compose
 *  container gets automatically) to find its containers, since `docker
 *  stats` itself has no `--filter` flag, then `docker stats --no-stream` on
 *  exactly those. Zero containers (tenant not up, or just destroyed mid-tick)
 *  → 0 bytes, not an error. */
export async function sampleTenantMemoryBytes(
	acct8: string,
	runDocker: RunDocker = spawnDocker,
): Promise<number> {
	const ps = await runDocker([
		"ps",
		"-q",
		"--filter",
		`label=com.docker.compose.project=tenant-${acct8}`,
	]);
	const ids = ps.stdout
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	if (ids.length === 0) return 0;

	const stats = await runDocker([
		"stats",
		"--no-stream",
		"--format",
		"{{.MemUsage}}",
		...ids,
	]);
	return parseDockerStatsMemUsageBytes(stats.stdout);
}

/** Parse `psql -tAc "SELECT pg_database_size(...)"` output — a bare integer
 *  string, one line, possibly with trailing whitespace. */
export function parsePgDatabaseSizeOutput(output: string): number {
	const n = Number(output.trim());
	return Number.isFinite(n) ? n : 0;
}

/** Real storage sample for one tenant: `pg_database_size` via `docker exec`
 *  into that tenant's own `postgres` container — no network hop, no
 *  credential needed beyond `docker exec` access the provisioner already
 *  has as the container's operator. */
export async function sampleTenantDatabaseBytes(
	acct8: string,
	runDocker: RunDocker = spawnDocker,
): Promise<number> {
	const result = await runDocker([
		"exec",
		`tenant-${acct8}-postgres-1`,
		"psql",
		"-U",
		"secondlayer",
		"-d",
		"secondlayer",
		"-tAc",
		"SELECT pg_database_size('secondlayer')",
	]);
	if (result.code !== 0) return 0;
	return parsePgDatabaseSizeOutput(result.stdout);
}

/** What keeps a stack worth running: active webhooks plus subgraphs (any
 *  status, since a halted subgraph's data is still served). Read via
 *  `docker exec` into the tenant's own postgres, same as the storage sample.
 *  `null` when the count can't be read: callers must never stop a tenant on
 *  an unreadable count. */
export async function countTenantWorkloads(
	acct8: string,
	runDocker: RunDocker = spawnDocker,
): Promise<number | null> {
	let result: DockerResult;
	try {
		result = await runDocker([
			"exec",
			`tenant-${acct8}-postgres-1`,
			"psql",
			"-U",
			"secondlayer",
			"-d",
			"secondlayer",
			"-tAc",
			"SELECT (SELECT count(*) FROM webhooks WHERE status = 'active') + (SELECT count(*) FROM subgraphs)",
		]);
	} catch {
		return null;
	}
	if (result.code !== 0) return null;
	const text = result.stdout.trim();
	if (!/^\d+$/.test(text)) return null;
	return Number(text);
}

/** Batches `items` at `MAX_METER_BATCH` (`/internal/meters`'s own cap) and
 *  flushes each page; a failed page is logged and its items are returned so
 *  the caller can resend them (unchanged — same idempotency keys) on a later
 *  tick, rather than losing the whole run over one bad page. */
export async function flushAll(
	cfg: MetersClientConfig,
	items: MeterBatchItem[],
	maxBatch: number,
): Promise<MeterBatchItem[]> {
	const failed: MeterBatchItem[] = [];
	for (let i = 0; i < items.length; i += maxBatch) {
		const page = items.slice(i, i + maxBatch);
		try {
			await flushMeterBatch(cfg, page);
		} catch (err) {
			logger.error("workload.meters.flush_failed", {
				count: page.length,
				error: err instanceof Error ? err.message : String(err),
			});
			failed.push(...page);
		}
	}
	return failed;
}

export interface ShutdownFlushState {
	eventCounters: Map<string, EventCounter>;
	eventWindow: DrainWindow;
	eventPending: MeterBatchItem[];
	memory: MemoryAccumulator;
	memoryPending: MeterBatchItem[];
	storagePending: MeterBatchItem[];
}

/**
 * Drains every meter's live in-process state into one item list for a final
 * shutdown flush, ahead of each meter's own already-buffered retry items.
 * Event and memory items are keyed by the window they cover, which starts
 * where the previous flush ended, so this flush can never share a key with
 * an earlier flush in the same minute or hour. Storage has no in-process
 * accumulator to drain — each sample reads live `pg_database_size` — so only
 * its pending retry buffer is included. Mutates `state`: drains each
 * counter and the memory accumulator, like the periodic loops do.
 */
export function collectShutdownFlushItems(
	state: ShutdownFlushState,
	now: Date = new Date(),
): MeterBatchItem[] {
	const items: MeterBatchItem[] = [
		...state.eventPending,
		...state.memoryPending,
		...state.storagePending,
	];

	const eventWindow = state.eventWindow.roll(now);
	for (const [accountId, counter] of state.eventCounters) {
		const item = eventsMeterItem(accountId, counter.drain(), eventWindow);
		if (item) items.push(item);
	}
	items.push(...state.memory.drain(now));

	return items;
}

/** Structured record of meter quantities that will never be billed (buffer
 *  overflow, failed shutdown flush). Totals per unit plus the heaviest
 *  accounts, so the loss can be reconciled by hand. */
export function logDroppedMeters(
	reason: string,
	dropped: MeterBatchItem[],
): void {
	if (dropped.length === 0) return;
	const byUnit: Record<string, number> = {};
	const byAccount = new Map<string, number>();
	for (const item of dropped) {
		byUnit[item.unit] = (byUnit[item.unit] ?? 0) + item.quantity;
		const k = `${item.accountId}:${item.unit}`;
		byAccount.set(k, (byAccount.get(k) ?? 0) + item.quantity);
	}
	const top = [...byAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
	logger.error("meter.dropped", {
		reason,
		count: dropped.length,
		byUnit,
		byAccount: Object.fromEntries(top),
	});
}

/**
 * Flushes shutdown items bounded by `timeoutMs` — a hung flush (e.g. a dead
 * app-server) must never delay process exit past the deadline. Pages that
 * fail outright are logged as dropped; on a timeout whatever hadn't landed
 * is lost this restart, and the timeout is logged.
 */
export async function flushOnShutdown(
	cfg: MetersClientConfig,
	items: MeterBatchItem[],
	maxBatch: number,
	timeoutMs: number,
): Promise<void> {
	if (items.length === 0) return;
	let timedOut = false;
	await Promise.race([
		flushAll(cfg, items, maxBatch).then((failed) => {
			logDroppedMeters("shutdown_flush_failed", failed);
		}),
		new Promise<void>((resolve) =>
			setTimeout(() => {
				timedOut = true;
				resolve();
			}, timeoutMs),
		),
	]);
	if (timedOut) {
		logger.error("meter.shutdown_flush_timeout", { count: items.length });
	}
}

/** Default cap for a caller's retry buffer (see `mergePending`) — generous
 *  enough to ride out a long app-server deploy without ever growing memory
 *  unbounded. */
export const DEFAULT_PENDING_CAP = 10_000;

/**
 * Combines a caller's unsent `pending` items (returned by a previous
 * `flushAll` failure) ahead of freshly-sampled `fresh` ones, then caps the
 * result at `cap` by dropping the OLDEST items — never the newest, and never
 * rebuilding an item, so a retried item keeps its original idempotency key
 * across ticks. Dropped items are returned so the caller can log them
 * (`logDroppedMeters`).
 */
export function mergePending(
	pending: MeterBatchItem[],
	fresh: MeterBatchItem[],
	cap: number = DEFAULT_PENDING_CAP,
): {
	items: MeterBatchItem[];
	droppedCount: number;
	dropped: MeterBatchItem[];
} {
	const merged = [...pending, ...fresh];
	if (merged.length <= cap) {
		return { items: merged, droppedCount: 0, dropped: [] };
	}
	const droppedCount = merged.length - cap;
	return {
		items: merged.slice(droppedCount),
		droppedCount,
		dropped: merged.slice(0, droppedCount),
	};
}
