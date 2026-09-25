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
 * All three funnel through `flushMeterBatch`, batched, with the exact
 * idempotency-key shapes the Design calls out — a re-sent batch (a crashed
 * flush retried) never double-charges.
 */

import type { MeterUnit } from "@secondlayer/platform/billing/prices";
import { logger } from "@secondlayer/shared";
import type { FetchLike } from "./fetch-like.ts";

export interface MeterBatchItem {
	accountId: string;
	unit: MeterUnit;
	quantity: number;
	idempotencyKey: string;
	occurredAt?: string;
}

/** `mem:<account>:<yyyy-mm-ddThh>` (Design) — one row per tenant per hour. */
export function memoryIdempotencyKey(accountId: string, at: Date): string {
	return `mem:${accountId}:${at.toISOString().slice(0, 13)}`;
}

/** `storage:<account>:<yyyy-mm-dd>` (Design) — one row per tenant per day. */
export function storageIdempotencyKey(accountId: string, at: Date): string {
	return `storage:${accountId}:${at.toISOString().slice(0, 10)}`;
}

/** `evt:<account>:<yyyy-mm-ddThh:mm>` (Design) — one row per tenant per
 *  minute; retries are never counted (the socket only ever sees a
 *  successful delivery, `emitter.ts`'s `settleDelivered`). */
export function eventsIdempotencyKey(accountId: string, at: Date): string {
	return `evt:${accountId}:${at.toISOString().slice(0, 16)}`;
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

/** One tenant's memory sample: RSS summed across its containers, in GiB.
 *  `sampleCgroupBytes` is injected so tests never shell out to `docker
 *  stats`; the real implementation lives in `index.ts` (needs the compose
 *  project name → container list mapping). */
export async function sampleMemoryGbHour(
	accountId: string,
	sampleCgroupBytes: (accountId: string) => Promise<number>,
	intervalSeconds: number,
): Promise<MeterBatchItem> {
	const bytes = await sampleCgroupBytes(accountId);
	const gb = bytes / 1024 ** 3;
	const gbHours = gb * (intervalSeconds / 3600);
	return {
		accountId,
		unit: "memory.gb_hour",
		quantity: gbHours,
		idempotencyKey: memoryIdempotencyKey(accountId, new Date()),
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
	return {
		accountId,
		unit: "storage.gb_day",
		quantity: gb,
		idempotencyKey: storageIdempotencyKey(accountId, new Date()),
	};
}

export function eventsMeterItem(
	accountId: string,
	count: number,
): MeterBatchItem | undefined {
	if (count <= 0) return undefined;
	return {
		accountId,
		unit: "webhook.event",
		quantity: count,
		idempotencyKey: eventsIdempotencyKey(accountId, new Date()),
	};
}

/** Batches `items` at `MAX_METER_BATCH` (`/internal/meters`'s own cap) and
 *  flushes each page; a failed page is logged and left for the next tick
 *  rather than losing the whole run over one bad page. */
export async function flushAll(
	cfg: MetersClientConfig,
	items: MeterBatchItem[],
	maxBatch: number,
): Promise<void> {
	for (let i = 0; i < items.length; i += maxBatch) {
		const page = items.slice(i, i + maxBatch);
		try {
			await flushMeterBatch(cfg, page);
		} catch (err) {
			logger.error("workload.meters.flush_failed", {
				count: page.length,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
