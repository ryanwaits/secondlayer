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
const LIVE_SHARE = 0.9; // 90% of batch to non-replay, 10% to replay
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600, 86400, 259200];
const CIRCUIT_THRESHOLD = 20;
/**
 * When a batch is claimed the outbox row's `next_attempt_at` is pushed
 * `LOCK_WINDOW_MS` into the future. Any crash between claim + settle
 * leaves the row re-claimable after this window expires — the SSOT for
 * double-dispatch prevention.
 */
const LOCK_WINDOW_MS = 60_000;

interface RunningState {
	running: boolean;
	inFlightBySub: Map<string, number>;
	claimInFlight: boolean;
}

function nextDelaySeconds(attempt: number): number {
	return BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)]!;
}

// ── SSRF guard ────────────────────────────────────────────────────────
// Block deliveries to private/loopback/link-local ranges unless
// SECONDLAYER_ALLOW_PRIVATE_EGRESS=true (self-host + local-dev opt-in).

const PRIVATE_V4_PATTERNS = [
	/^127\./, // loopback
	/^10\./, // private class A
	/^172\.(1[6-9]|2\d|3[01])\./, // private class B
	/^192\.168\./, // private class C
	/^169\.254\./, // link-local
	/^0\./, // "this" network
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];

/**
 * Reject hostnames that resolve to, or are spelled as, private IPs.
 * Covers v4 literal, v6 literal, IPv4-mapped IPv6 (`::ffff:127.0.0.1`),
 * and the `localhost` alias. DNS-level rebinding still bypasses this
 * check (hostname that resolves to a private IP at egress time) — mitigate
 * with an egress allowlist at the network level if that matters.
 */
function isPrivateEgress(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return true; // malformed URL: reject
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return true;
	}

	// Strip brackets from IPv6 literals.
	const raw = parsed.hostname.toLowerCase();
	const host = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

	if (host === "localhost" || host === "0.0.0.0") return true;
	if (host === "::" || host === "::1") return true;
	// Unique-local (fc00::/7) + link-local (fe80::/10)
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
	if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

	// IPv4-mapped IPv6 — `::ffff:127.0.0.1` or `::ffff:7f00:0001`
	const mapped = host.match(/^::ffff:(.+)$/);
	if (mapped) {
		const inner = mapped[1]!;
		// Dotted form: rerun v4 checks.
		if (/^\d+\.\d+\.\d+\.\d+$/.test(inner)) {
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(inner)) return true;
		}
		// Hex form: 7f00:0001 → 127.0.0.1
		const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (hex) {
			const a = Number.parseInt(hex[1]!, 16);
			const b = Number.parseInt(hex[2]!, 16);
			const dotted = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(dotted)) return true;
		}
	}

	for (const p of PRIVATE_V4_PATTERNS) {
		if (p.test(host)) return true;
	}
	return false;
}

function allowPrivateEgress(): boolean {
	return process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS === "true";
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

	if (isPrivateEgress(sub.url) && !allowPrivateEgress()) {
		error = "refused private egress (set SECONDLAYER_ALLOW_PRIVATE_EGRESS=true to allow)";
		logger.warn("[emitter] refused private egress", {
			subscription: sub.name,
			url: sub.url,
		});
		const durationMs = 0;
		const attempt = outboxRow.attempt + 1;
		await db
			.insertInto("subscription_deliveries")
			.values({
				outbox_id: outboxRow.id,
				subscription_id: outboxRow.subscription_id,
				attempt,
				status_code: null,
				response_headers: null,
				response_body: null,
				error_message: error,
				duration_ms: durationMs,
			})
			.execute();
		return { ok: false, statusCode: null, error, durationMs };
	}

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

		// Atomic increment — concurrent failures must not clobber each other.
		// `RETURNING circuit_failures` gives us the post-increment value to
		// decide whether this failure tripped the circuit.
		const incResult = await sql<{ circuit_failures: number }>`
			UPDATE subscriptions
			SET circuit_failures = circuit_failures + 1,
				last_delivery_at = NOW(),
				last_error = ${errText.slice(0, 500)},
				updated_at = NOW()
			WHERE id = ${sub.id}
			RETURNING circuit_failures
		`.execute(tx);
		const newFailures = incResult.rows[0]?.circuit_failures ?? sub.circuit_failures + 1;
		const shouldTripCircuit = newFailures >= CIRCUIT_THRESHOLD;

		if (shouldTripCircuit) {
			// Transition to paused only on the first failure that crossed
			// the threshold — additional failures in-flight harmlessly
			// re-set the same fields.
			await tx
				.updateTable("subscriptions")
				.set({
					status: "paused",
					circuit_opened_at: new Date(),
					updated_at: new Date(),
				})
				.where("id", "=", sub.id)
				.execute();
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
		// 90/10 live vs replay so a big replay doesn't starve live emits.
		const liveLimit = Math.max(1, Math.round(BATCH_SIZE * LIVE_SHARE));
		const replayLimit = BATCH_SIZE - liveLimit;
		const claimed = await db
			.transaction()
			.execute(async (tx) => {
				const live = await sql<SubscriptionOutbox>`
					SELECT * FROM subscription_outbox
					WHERE status = 'pending'
						AND next_attempt_at <= NOW()
						AND is_replay = FALSE
					ORDER BY next_attempt_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${sql.lit(liveLimit)}
				`.execute(tx);
				const replay = await sql<SubscriptionOutbox>`
					SELECT * FROM subscription_outbox
					WHERE status = 'pending'
						AND next_attempt_at <= NOW()
						AND is_replay = TRUE
					ORDER BY next_attempt_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${sql.lit(replayLimit)}
				`.execute(tx);

				const combined = [...live.rows, ...replay.rows];
				if (combined.length === 0) return [];

				// Push `next_attempt_at` forward by the lock window. This is
				// the only defense against double-dispatch if the emitter
				// process crashes mid-HTTP-call: the row won't be re-claimable
				// until `LOCK_WINDOW_MS` elapses, giving us a stale-lock
				// recovery window. `settleDelivered`/`settleFailed` overrides
				// this on the success/failure path.
				const now = new Date();
				const lockUntil = new Date(now.getTime() + LOCK_WINDOW_MS);
				await tx
					.updateTable("subscription_outbox")
					.set({
						locked_by: emitterId,
						locked_until: lockUntil,
						next_attempt_at: lockUntil,
					})
					.where(
						"id",
						"in",
						combined.map((r) => r.id),
					)
					.execute();
				return combined;
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

	// Bootstrap matcher from active subs. Retry with backoff — if this
	// stays broken, fail loud rather than run with an empty matcher (which
	// would silently drop every block's outbox emissions until the next
	// subscription CRUD fired `subscriptions:changed`).
	const MATCHER_BOOT_ATTEMPTS = 5;
	let lastErr: unknown = null;
	for (let i = 0; i < MATCHER_BOOT_ATTEMPTS; i++) {
		try {
			await refreshMatcher(db);
			lastErr = null;
			break;
		} catch (err) {
			lastErr = err;
			const delayMs = 500 * 2 ** i; // 500ms, 1s, 2s, 4s, 8s
			logger.warn("[emitter] matcher refresh failed, retrying", {
				attempt: i + 1,
				delayMs,
				error: err instanceof Error ? err.message : String(err),
			});
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
	if (lastErr) {
		throw new Error(
			`[emitter] matcher refresh failed ${MATCHER_BOOT_ATTEMPTS}×; aborting boot: ${
				lastErr instanceof Error ? lastErr.message : String(lastErr)
			}`,
		);
	}

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
