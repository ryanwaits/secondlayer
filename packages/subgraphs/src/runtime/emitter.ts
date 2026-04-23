import {
	type Database,
	getTargetDb,
	type Subscription,
	type SubscriptionOutbox,
} from "@secondlayer/shared/db";
import {
	getSubscriptionSigningSecret,
} from "@secondlayer/shared/db/queries/subscriptions";
import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import { type Kysely, sql } from "kysely";
import { buildForFormat } from "./formats/index.ts";
import { refreshMatcher } from "./subscription-state.ts";

/**
 * Subscription emitter — drains `subscription_outbox` and POSTs deliveries.
 *
 * Hot path: LISTEN on `subscriptions:new_outbox` and `subscriptions:changed`.
 * On notify, claim a batch with `FOR UPDATE SKIP LOCKED LIMIT 50`, dispatch
 * each row via HTTP, write a `subscription_deliveries` attempt row, then
 * either mark `status='delivered'` or schedule the next attempt.
 *
 * Backoff schedule (attempt → wait):
 *   0 → 30s, 1 → 2m, 2 → 10m, 3 → 1h, 4 → 6h, 5 → 24h, 6 → 72h.
 * After `max_retries` (default 7) attempts → `status='dead'`.
 *
 * Per-sub circuit breaker: 20 consecutive failures → sub flipped to
 * `paused` with `circuit_opened_at=NOW()`. Manual /resume drains backlog.
 *
 * Per-sub concurrency cap: in-memory semaphore, default 4 in-flight HTTP
 * requests per subscription. Sprint-4 adds SSRF allowlist.
 */

const BATCH_SIZE = 50;
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600, 86400, 259200];
const CIRCUIT_THRESHOLD = 20;

interface RunningState {
	running: boolean;
	inFlightBySub: Map<string, number>;
	claimInFlight: boolean;
}

function nextDelaySeconds(attempt: number): number {
	return BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)]!;
}

async function dispatchOne(
	db: Kysely<Database>,
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null; durationMs: number }> {
	const { body, headers } = buildForFormat(
		outboxRow,
		sub,
		getSubscriptionSigningSecret(sub),
	);

	const start = performance.now();
	let statusCode: number | null = null;
	let error: string | null = null;
	let ok = false;
	let responseBody = "";
	let responseHeaders: Record<string, string> = {};

	try {
		const res = await fetch(sub.url, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(sub.timeout_ms),
		});
		statusCode = res.status;
		ok = res.ok;
		// Collect small response preview for the delivery log (≤8KB).
		const buf = await res.arrayBuffer();
		const truncated = buf.byteLength > 8192 ? buf.slice(0, 8192) : buf;
		responseBody = Buffer.from(truncated).toString("utf8");
		responseHeaders = Object.fromEntries(res.headers.entries());
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	const durationMs = Math.round(performance.now() - start);

	const attempt = outboxRow.attempt + 1;
	await db
		.insertInto("subscription_deliveries")
		.values({
			outbox_id: outboxRow.id,
			subscription_id: outboxRow.subscription_id,
			attempt,
			status_code: statusCode,
			response_headers: responseHeaders,
			response_body: responseBody || null,
			error_message: error,
			duration_ms: durationMs,
		})
		.execute();

	return { ok, statusCode, error, durationMs };
}

async function settleDelivered(
	db: Kysely<Database>,
	outboxRow: SubscriptionOutbox,
): Promise<void> {
	await db.transaction().execute(async (tx) => {
		await tx
			.updateTable("subscription_outbox")
			.set({
				status: "delivered",
				delivered_at: new Date(),
				attempt: outboxRow.attempt + 1,
				locked_by: null,
				locked_until: null,
			})
			.where("id", "=", outboxRow.id)
			.execute();
		await tx
			.updateTable("subscriptions")
			.set({
				last_delivery_at: new Date(),
				last_success_at: new Date(),
				circuit_failures: 0,
				last_error: null,
				updated_at: new Date(),
			})
			.where("id", "=", outboxRow.subscription_id)
			.execute();
	});
}

async function settleFailed(
	db: Kysely<Database>,
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
	errText: string,
): Promise<void> {
	const attempt = outboxRow.attempt + 1;
	const isDead = attempt >= sub.max_retries;
	const nextAt = isDead ? null : new Date(Date.now() + nextDelaySeconds(outboxRow.attempt) * 1000);

	await db.transaction().execute(async (tx) => {
		await tx
			.updateTable("subscription_outbox")
			.set({
				attempt,
				next_attempt_at: nextAt ?? new Date(),
				status: isDead ? "dead" : "pending",
				failed_at: isDead ? new Date() : null,
				locked_by: null,
				locked_until: null,
			})
			.where("id", "=", outboxRow.id)
			.execute();

		const newFailures = sub.circuit_failures + 1;
		const shouldTripCircuit = newFailures >= CIRCUIT_THRESHOLD;

		await tx
			.updateTable("subscriptions")
			.set({
				last_delivery_at: new Date(),
				last_error: errText.slice(0, 500),
				circuit_failures: newFailures,
				...(shouldTripCircuit
					? { status: "paused", circuit_opened_at: new Date() }
					: {}),
				updated_at: new Date(),
			})
			.where("id", "=", outboxRow.subscription_id)
			.execute();

		if (shouldTripCircuit) {
			logger.warn("Subscription circuit tripped — paused after consecutive failures", {
				subscription: sub.name,
				failures: newFailures,
			});
		}
	});
}

async function claimAndDrain(
	db: Kysely<Database>,
	state: RunningState,
	emitterId: string,
): Promise<number> {
	if (state.claimInFlight) return 0;
	state.claimInFlight = true;
	try {
		// FOR UPDATE SKIP LOCKED — multiple emitters split the batch.
		const claimed = await db
			.transaction()
			.execute(async (tx) => {
				const rows = await sql<SubscriptionOutbox>`
					SELECT * FROM subscription_outbox
					WHERE status = 'pending' AND next_attempt_at <= NOW()
					ORDER BY next_attempt_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${sql.lit(BATCH_SIZE)}
				`.execute(tx);

				if (rows.rows.length === 0) return [];

				const now = new Date();
				const lockUntil = new Date(now.getTime() + 60_000); // 1-minute lock window
				await tx
					.updateTable("subscription_outbox")
					.set({ locked_by: emitterId, locked_until: lockUntil })
					.where(
						"id",
						"in",
						rows.rows.map((r) => r.id),
					)
					.execute();
				return rows.rows;
			});

		if (claimed.length === 0) return 0;

		// Hydrate each claimed row's sub once, then dispatch with per-sub
		// concurrency cap enforced via in-memory semaphore.
		const bySubId = new Map<string, SubscriptionOutbox[]>();
		for (const row of claimed) {
			const arr = bySubId.get(row.subscription_id);
			if (arr) arr.push(row);
			else bySubId.set(row.subscription_id, [row]);
		}

		const subIds = Array.from(bySubId.keys());
		const subs = await db
			.selectFrom("subscriptions")
			.selectAll()
			.where("id", "in", subIds)
			.execute();
		const subById = new Map(subs.map((s) => [s.id, s]));

		await Promise.all(
			subIds.map((subId) =>
				drainForSub(db, state, subById.get(subId)!, bySubId.get(subId)!),
			),
		);

		return claimed.length;
	} finally {
		state.claimInFlight = false;
	}
}

async function drainForSub(
	db: Kysely<Database>,
	state: RunningState,
	sub: Subscription,
	rows: SubscriptionOutbox[],
): Promise<void> {
	const cap = sub.concurrency || 4;
	const counter = () => state.inFlightBySub.get(sub.id) ?? 0;
	const inc = () => state.inFlightBySub.set(sub.id, counter() + 1);
	const dec = () => state.inFlightBySub.set(sub.id, Math.max(0, counter() - 1));

	const queue = [...rows];
	const workers: Promise<void>[] = [];
	const slots = Math.min(cap, queue.length);

	for (let i = 0; i < slots; i++) {
		workers.push(
			(async () => {
				while (state.running && queue.length > 0) {
					const row = queue.shift();
					if (!row) break;
					inc();
					try {
						const result = await dispatchOne(db, row, sub);
						if (result.ok) {
							await settleDelivered(db, row);
						} else {
							const err = result.error ?? `HTTP ${result.statusCode ?? "?"}`;
							await settleFailed(db, row, sub, err);
						}
					} catch (err) {
						logger.error("Emitter dispatch crashed", {
							outboxId: row.id,
							error: err instanceof Error ? err.message : String(err),
						});
						await settleFailed(
							db,
							row,
							sub,
							err instanceof Error ? err.message : String(err),
						);
					} finally {
						dec();
					}
				}
			})(),
		);
	}
	await Promise.all(workers);
}

export interface StartEmitterOptions {
	/** Interval for the background poll (ms). Defaults to 2 minutes. */
	pollIntervalMs?: number;
	/** Retention sweep interval (ms). Defaults to 1 hour. */
	retentionIntervalMs?: number;
}

async function runRetention(db: Kysely<Database>): Promise<void> {
	// delivered outbox >7d, deliveries >30d, dead outbox >90d
	await sql`
		DELETE FROM subscription_outbox
		WHERE status = 'delivered' AND delivered_at < NOW() - interval '7 days'
	`.execute(db);
	await sql`
		DELETE FROM subscription_deliveries
		WHERE dispatched_at < NOW() - interval '30 days'
	`.execute(db);
	await sql`
		DELETE FROM subscription_outbox
		WHERE status = 'dead' AND failed_at < NOW() - interval '90 days'
	`.execute(db);
}

export async function startEmitter(
	opts?: StartEmitterOptions,
): Promise<() => Promise<void>> {
	const emitterId = `emitter-${Math.random().toString(36).slice(2, 10)}`;
	const db = getTargetDb();
	const state: RunningState = {
		running: true,
		inFlightBySub: new Map(),
		claimInFlight: false,
	};
	const pollIntervalMs = opts?.pollIntervalMs ?? 120_000;
	const retentionIntervalMs = opts?.retentionIntervalMs ?? 60 * 60_000;

	logger.info("[emitter] started", { id: emitterId });

	// Bootstrap matcher from active subs.
	await refreshMatcher(db).catch((err) => {
		logger.error("[emitter] initial matcher refresh failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	});

	// LISTEN on new outbox + sub changes
	const stopNew = await listen(
		"subscriptions:new_outbox",
		() => {
			if (!state.running) return;
			void claimAndDrain(db, state, emitterId).catch((err) =>
				logger.error("[emitter] claim failed", {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		},
	);
	const stopChanged = await listen(
		"subscriptions:changed",
		() => {
			if (!state.running) return;
			void refreshMatcher(db).catch((err) =>
				logger.error("[emitter] matcher refresh failed", {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		},
	);

	// Poll every pollIntervalMs as a safety net for missed notifications +
	// backoff wakeups (rows whose next_attempt_at has passed).
	const poll = setInterval(() => {
		if (!state.running) return;
		void claimAndDrain(db, state, emitterId).catch((err) =>
			logger.error("[emitter] poll claim failed", {
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}, pollIntervalMs);

	// Kick once on startup so any rows that arrived before we started drain.
	void claimAndDrain(db, state, emitterId);

	// Retention sweep — hourly by default.
	const retention = setInterval(() => {
		if (!state.running) return;
		void runRetention(db).catch((err) =>
			logger.error("[emitter] retention failed", {
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}, retentionIntervalMs);

	return async () => {
		state.running = false;
		clearInterval(poll);
		clearInterval(retention);
		await stopNew();
		await stopChanged();
		logger.info("[emitter] stopped", { id: emitterId });
	};
}
