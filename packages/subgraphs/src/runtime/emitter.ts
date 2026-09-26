import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import {
	type Database,
	type Webhook,
	type WebhookOutbox,
	describeDbUrl,
	getTargetDb,
} from "@secondlayer/shared/db";
import { getWebhookSigningSecret } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import { listen, targetListenerUrl } from "@secondlayer/shared/queue/listener";
import {
	type WebhookTestResult,
	webhookTimeoutMsCeiling,
} from "@secondlayer/shared/schemas/webhooks";
import { type Kysely, sql } from "kysely";
import { buildForFormat } from "./formats/index.ts";
import { recordDelivery } from "./meter-socket.ts";
import { refreshMatcher } from "./webhook-state.ts";

/**
 * Webhook emitter — drains `webhook_outbox` and POSTs deliveries.
 *
 * Hot path: LISTEN on `webhooks:new_outbox` and `webhooks:changed`.
 * On notify, claim a batch with `FOR UPDATE SKIP LOCKED LIMIT 50`, dispatch
 * each row via HTTP, write a `webhook_deliveries` attempt row, then
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
 * requests per webhook. Sprint-4 adds SSRF allowlist.
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
 *
 * Must exceed the maximum possible in-flight delivery time so a slow-but-alive
 * receiver's row is never re-claimed mid-delivery (duplicate dispatch). Derived
 * from the configurable timeout ceiling (`WEBHOOK_TIMEOUT_MS_CEILING`, default
 * 300_000ms — see `webhookTimeoutMsCeiling` in shared/schemas/webhooks.ts) so a
 * raised ceiling can never create a delivery window shorter than a webhook's
 * own timeout.
 */
export const MAX_WEBHOOK_TIMEOUT_MS: number = webhookTimeoutMsCeiling();
export const LOCK_WINDOW_MS: number = MAX_WEBHOOK_TIMEOUT_MS + 60_000; // ceiling + settle margin

interface RunningState {
	running: boolean;
	inFlightBySub: Map<string, number>;
	claimInFlight: boolean;
	/** Set when a wake (NOTIFY) arrives while a claim cycle is already
	 *  running. The in-flight cycle checks this before releasing the lock —
	 *  see `claimAndDrain`'s "drain-loop" pass — so rows that land mid-drain
	 *  aren't stranded until an unrelated future wake or the safety poll. */
	claimPending: boolean;
}

function nextDelaySeconds(attempt: number): number {
	// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
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
	/^198\.(1[89])\./, // benchmarking 198.18.0.0/15
	/^(22[4-9]|23[0-9])\./, // multicast 224.0.0.0/4
	/^(24[0-9]|25[0-5])\./, // reserved 240.0.0.0/4 (incl. 255.255.255.255 broadcast)
];

/**
 * Classify a raw IP address literal (v4 or v6, no brackets, already lowercased
 * or not) as private/loopback/link-local/reserved. Covers v4 private ranges +
 * link-local (incl. `169.254.169.254`), `0.0.0.0`, benchmarking
 * (`198.18.0.0/15`), multicast (`224.0.0.0/4`), reserved/broadcast
 * (`240.0.0.0/4`, incl. `255.255.255.255`), IPv6 loopback (`::1`), unspecified
 * (`::`), unique-local (`fc00::/7`), link-local (`fe80::/10`), IPv6 multicast
 * (`ff00::/8`), IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:7f00:0001`), and
 * NAT64 (`64:ff9b::/96`, embedded v4 classified the same as IPv4-mapped).
 *
 * Shared by `isPrivateEgress` (literal-hostname fast-fail) and the resolved-
 * DNS-address check in `checkEgressAllowed` (rebinding mitigation).
 */
function isPrivateIp(address: string): boolean {
	const host = address.toLowerCase();

	if (host === "0.0.0.0") return true;
	if (host === "::" || host === "::1") return true;
	// Unique-local (fc00::/7) + link-local (fe80::/10) + multicast (ff00::/8)
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
	if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
	if (/^ff[0-9a-f]{2}:/.test(host)) return true;

	// IPv4-mapped IPv6 — `::ffff:127.0.0.1` or `::ffff:7f00:0001`
	const mapped = host.match(/^::ffff:(.+)$/);
	if (mapped) {
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		const inner = mapped[1]!;
		// Dotted form: rerun v4 checks.
		if (/^\d+\.\d+\.\d+\.\d+$/.test(inner)) {
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(inner)) return true;
		}
		// Hex form: 7f00:0001 → 127.0.0.1
		const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (hex) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const a = Number.parseInt(hex[1]!, 16);
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const b = Number.parseInt(hex[2]!, 16);
			const dotted = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(dotted)) return true;
		}
		return false;
	}

	// NAT64 (`64:ff9b::/96`) embeds an IPv4 address in the low 32 bits —
	// classify it exactly like the IPv4-mapped case above (dotted or hex).
	const nat64 = host.match(/^64:ff9b::(.+)$/);
	if (nat64) {
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		const inner = nat64[1]!;
		if (/^\d+\.\d+\.\d+\.\d+$/.test(inner)) {
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(inner)) return true;
		}
		const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (hex) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const a = Number.parseInt(hex[1]!, 16);
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const b = Number.parseInt(hex[2]!, 16);
			const dotted = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
			for (const p of PRIVATE_V4_PATTERNS) if (p.test(dotted)) return true;
		}
		return false;
	}

	for (const p of PRIVATE_V4_PATTERNS) {
		if (p.test(host)) return true;
	}
	return false;
}

/**
 * Reject hostnames spelled as private IPs (cheap, synchronous, no I/O — a
 * fast-fail pre-filter). DNS-level rebinding (hostname that *resolves* to a
 * private IP at egress time) is NOT caught here — see `checkEgressAllowed`,
 * which resolves DNS and validates every returned address.
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
	const host =
		raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

	if (host === "localhost") return true;
	return isPrivateIp(host);
}

function allowPrivateEgress(): boolean {
	return process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS === "true";
}

interface ResolvedAddress {
	address: string;
	family: number;
}

type DnsLookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

async function defaultDnsLookup(hostname: string): Promise<ResolvedAddress[]> {
	return dnsLookup(hostname, { all: true });
}

let dnsLookupImpl: DnsLookupFn = defaultDnsLookup;

/**
 * Test-only seam: inject a fake DNS resolver so tests can simulate a hostname
 * resolving to a private/metadata IP without depending on real DNS or
 * network access. Pass `null` to restore the real `dns.lookup`-backed
 * resolver. Production code never calls this — only `ssrf.test.ts` does.
 */
export function __setDnsLookupForTest(fn: DnsLookupFn | null): void {
	dnsLookupImpl = fn ?? defaultDnsLookup;
}

const ALLOW_HINT = "(set SECONDLAYER_ALLOW_PRIVATE_EGRESS=true to allow)";

/**
 * Full egress check: literal fast-fail, then resolve DNS and reject if *any*
 * returned address (not just the first) is private/loopback/link-local —
 * a single private answer among several is enough for an attacker to abuse.
 *
 * Residual TOCTOU: this resolves-and-validates *immediately before* `fetch()`
 * but does not pin the actual connection to the validated address. True
 * pinning (resolve once, connect to that literal IP, keep the original `Host`
 * header/SNI) was attempted per plan f053 via a custom undici `Agent` with
 * `connect.lookup` passed as `fetch()`'s `dispatcher` — the standard Node
 * ecosystem pattern for this. Empirically, under Bun 1.3.10, that hook was
 * silently never invoked (confirmed with a throwaway smoke test hitting a
 * real local HTTP server: `lookupCalled` stayed `false` and the connection
 * failed even though the dispatcher was passed) — Bun's `fetch()` does not
 * implement undici's `connect.lookup` dispatcher hook, whether reached via
 * the global `fetch` or `import { fetch } from "undici"` (Bun overrides
 * "undici"'s `fetch` export with its own native implementation regardless of
 * an installed real `undici` package). Re-tested under Bun 1.4.2 (plan 043):
 * identical result — `lookupCalled` still stays `false` via both the global
 * `fetch` and `import { fetch } from "undici"`, so the gap remains unfixed at
 * this version too. So a second DNS answer between this check and `fetch()`'s
 * own resolution (true rebinding, not just a one-time private answer) could
 * in theory still slip through. This closes the practical rebinding gap
 * (attacker's hostname resolves private at delivery time) without adding a
 * dependency; a network-level egress allowlist/proxy is the recommended
 * defense-in-depth for the remaining TOCTOU sliver.
 */
export async function checkEgressAllowed(url: string): Promise<string | null> {
	if (isPrivateEgress(url)) {
		return `refused private egress: literal address ${ALLOW_HINT}`;
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return `refused private egress: malformed URL ${ALLOW_HINT}`;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return `refused private egress: unsupported protocol ${ALLOW_HINT}`;
	}

	const raw = parsed.hostname.toLowerCase();
	const hostname =
		raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

	let resolved: ResolvedAddress[];
	try {
		resolved = await dnsLookupImpl(hostname);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return `refused private egress: DNS resolution failed (${msg}) ${ALLOW_HINT}`;
	}
	if (resolved.length === 0) {
		return `refused private egress: DNS resolution returned no addresses ${ALLOW_HINT}`;
	}
	for (const { address } of resolved) {
		if (isPrivateIp(address)) {
			return `refused private egress: hostname resolves to private address ${address} ${ALLOW_HINT}`;
		}
	}
	return null;
}

/** The wire result of one POST attempt (no DB side effect) — shared by the
 *  emitter hot path and the `deliverTestEvent` test path. */
interface PostResult {
	ok: boolean;
	statusCode: number | null;
	error: string | null;
	durationMs: number;
	responseBody: string | null;
	responseHeaders: Record<string, string> | null;
}

/**
 * Bound on redirect hops honored while delivering a webhook. `fetch` is
 * called with `redirect: "manual"` so a 3xx never auto-follows — each hop's
 * target is re-validated through `checkEgressAllowed` before it is fetched
 * (see `postToWebhook`), otherwise a `Location` header pointing at a
 * private/metadata address would bypass the egress guard entirely. Counts
 * every fetch issued (the initial request plus each redirect), so this is
 * also the max number of `fetch` calls one delivery attempt can make.
 */
export const MAX_REDIRECT_HOPS: number = 3;

/** POST a pre-built body to a webhook URL with the SSRF guard + timeout.
 *  Pure transport: returns the attempt result; the caller logs the delivery row.
 *  Follows redirects manually (up to `MAX_REDIRECT_HOPS`), re-running the
 *  egress guard against every hop's target — the guard only protects the
 *  first request otherwise, and a webhook target can redirect to a private/
 *  metadata address to read back the response after f053 pinned the guard to
 *  just the original URL. */
async function postToWebhook(
	url: string,
	body: string,
	headers: Record<string, string>,
	timeoutMs: number,
): Promise<PostResult> {
	const start = performance.now();
	let target = url;
	let statusCode: number | null = null;
	let error: string | null = null;
	let ok = false;
	let responseBody = "";
	let responseHeaders: Record<string, string> | null = null;
	try {
		for (let hop = 0; ; hop++) {
			if (!allowPrivateEgress()) {
				const refusal = await checkEgressAllowed(target);
				if (refusal) {
					logger.warn("[emitter] refused private egress", {
						url: target,
						reason: refusal,
					});
					return {
						ok: false,
						statusCode: null,
						error: refusal,
						durationMs: Math.round(performance.now() - start),
						responseBody: null,
						responseHeaders: null,
					};
				}
			}
			if (hop >= MAX_REDIRECT_HOPS) {
				return {
					ok: false,
					statusCode,
					error: `too many redirects (exceeded ${MAX_REDIRECT_HOPS} hops)`,
					durationMs: Math.round(performance.now() - start),
					responseBody: null,
					responseHeaders: null,
				};
			}

			const res = await fetch(target, {
				method: "POST",
				headers,
				body,
				redirect: "manual",
				signal: AbortSignal.timeout(timeoutMs),
			});
			statusCode = res.status;

			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				target = new URL(location, target).toString();
				continue;
			}

			ok = res.ok;
			// Collect small response preview for the delivery log (≤8KB).
			const buf = await res.arrayBuffer();
			const truncated = buf.byteLength > 8192 ? buf.slice(0, 8192) : buf;
			responseBody = Buffer.from(truncated).toString("utf8");
			responseHeaders = Object.fromEntries(res.headers.entries());
			break;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	return {
		ok,
		statusCode,
		error,
		durationMs: Math.round(performance.now() - start),
		responseBody: responseBody || null,
		responseHeaders,
	};
}

/**
 * Test-only seam: exposes `postToWebhook` (otherwise module-private) so
 * redirect/egress behavior can be exercised directly against a stubbed
 * `fetch` + injected DNS lookup, without standing up the DB-backed emitter
 * loop. Production code never calls this — only tests do.
 */
export const __postToWebhookForTest: (
	url: string,
	body: string,
	headers: Record<string, string>,
	timeoutMs: number,
) => Promise<PostResult> = postToWebhook;

async function dispatchOne(
	db: Kysely<Database>,
	outboxRow: WebhookOutbox,
	sub: Webhook,
): Promise<{
	ok: boolean;
	statusCode: number | null;
	error: string | null;
	durationMs: number;
}> {
	const { body, headers } = buildForFormat(
		outboxRow,
		sub,
		getWebhookSigningSecret(sub),
	);
	const r = await postToWebhook(sub.url, body, headers, sub.timeout_ms);

	const attempt = outboxRow.attempt + 1;
	await db
		.insertInto("webhook_deliveries")
		.values({
			outbox_id: outboxRow.id,
			webhook_id: outboxRow.webhook_id,
			attempt,
			status_code: r.statusCode,
			response_headers: r.responseHeaders,
			response_body: r.responseBody,
			error_message: r.error,
			duration_ms: r.durationMs,
		})
		.execute();

	return {
		ok: r.ok,
		statusCode: r.statusCode,
		error: r.error,
		durationMs: r.durationMs,
	};
}

/** A representative (non-persisted) outbox row for a test delivery, shaped to the
 *  webhook's kind so `buildForFormat` produces a realistic body. */
function buildTestOutboxRow(sub: Webhook): WebhookOutbox {
	const now = new Date();
	return {
		id: randomUUID(),
		webhook_id: sub.id,
		kind: sub.kind,
		subgraph_name: sub.subgraph_name ?? null,
		table_name: sub.table_name ?? null,
		block_height: 0,
		tx_id: null,
		row_pk: null,
		event_type:
			sub.kind === "chain"
				? "chain.test.apply"
				: `${sub.subgraph_name ?? "subgraph"}.${sub.table_name ?? "test"}.created`,
		payload: {
			test: true,
			message: "Secondlayer test delivery",
			webhook_id: sub.id,
			sent_at: now.toISOString(),
		},
		dedup_key: `test:${sub.id}:${now.getTime()}`,
		attempt: 0,
		next_attempt_at: now,
		status: "pending",
		is_replay: false,
		block_time: null,
		delivered_at: null,
		failed_at: null,
		locked_by: null,
		locked_until: null,
		last_error: null,
		created_at: now,
	};
}

/**
 * Build a representative webhook for `sub`'s configured format, POST it (same
 * SSRF guard + timeout + signing as a real delivery), and log a delivery row
 * with a null `outbox_id` so it appears under the webhook's deliveries
 * without being tied to a queued event. Powers `POST /:id/test`.
 */
export async function deliverTestEvent(
	db: Kysely<Database>,
	sub: Webhook,
): Promise<WebhookTestResult> {
	const testRow = buildTestOutboxRow(sub);
	const { body, headers } = buildForFormat(
		testRow,
		sub,
		getWebhookSigningSecret(sub),
	);
	const r = await postToWebhook(sub.url, body, headers, sub.timeout_ms);
	const inserted = await db
		.insertInto("webhook_deliveries")
		.values({
			outbox_id: null,
			webhook_id: sub.id,
			attempt: 1,
			status_code: r.statusCode,
			response_headers: r.responseHeaders,
			response_body: r.responseBody,
			error_message: r.error,
			duration_ms: r.durationMs,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return {
		ok: r.ok,
		statusCode: r.statusCode,
		error: r.error,
		durationMs: r.durationMs,
		deliveryId: inserted.id,
	};
}

async function settleDelivered(
	db: Kysely<Database>,
	outboxRow: WebhookOutbox,
): Promise<void> {
	await db.transaction().execute(async (tx) => {
		const result = await tx
			.updateTable("webhook_outbox")
			.set({
				status: "delivered",
				delivered_at: new Date(),
				attempt: outboxRow.attempt + 1,
				locked_by: null,
				locked_until: null,
			})
			// Guard against a reorg that marked this row `dead` (orphaned) while
			// the POST was in flight — settling a delivery outcome must never
			// resurrect a row the reorg already decided is gone. `status='pending'`
			// is the only state a claimed row can settle from.
			.where("id", "=", outboxRow.id)
			.where("status", "=", "pending")
			.executeTakeFirst();
		if (Number(result.numUpdatedRows ?? 0) === 0) {
			logger.info("webhook.settle.orphaned", {
				outboxId: outboxRow.id,
				webhookId: outboxRow.webhook_id,
				outcome: "delivered",
			});
			return;
		}
		await tx
			.updateTable("webhooks")
			.set({
				last_delivery_at: new Date(),
				last_success_at: new Date(),
				circuit_failures: 0,
				last_error: null,
				updated_at: new Date(),
			})
			.where("id", "=", outboxRow.webhook_id)
			.execute();

		// Hosted-stack event meter (plan 044, step 5): counts a real delivery,
		// never a retry (this function only runs on the successful outcome) and
		// never a test delivery (`deliverTestEvent` never calls this). A no-op
		// on self-host (WEBHOOK_METER_SOCKET unset).
		recordDelivery();
	});
}

async function settleFailed(
	db: Kysely<Database>,
	outboxRow: WebhookOutbox,
	sub: Webhook,
	errText: string,
): Promise<void> {
	const attempt = outboxRow.attempt + 1;
	const isDead = attempt >= sub.max_retries;
	const nextAt = isDead
		? null
		: new Date(Date.now() + nextDelaySeconds(outboxRow.attempt) * 1000);

	await db.transaction().execute(async (tx) => {
		const result = await tx
			.updateTable("webhook_outbox")
			.set({
				attempt,
				next_attempt_at: nextAt ?? new Date(),
				status: isDead ? "dead" : "pending",
				failed_at: isDead ? new Date() : null,
				locked_by: null,
				locked_until: null,
			})
			// Guard against a reorg that marked this row `dead` (orphaned) while
			// the POST was in flight — see the matching guard in `settleDelivered`.
			.where("id", "=", outboxRow.id)
			.where("status", "=", "pending")
			.executeTakeFirst();
		if (Number(result.numUpdatedRows ?? 0) === 0) {
			logger.info("webhook.settle.orphaned", {
				outboxId: outboxRow.id,
				webhookId: outboxRow.webhook_id,
				outcome: "failed",
			});
			return;
		}

		// Atomic increment — concurrent failures must not clobber each other.
		// `RETURNING circuit_failures` gives us the post-increment value to
		// decide whether this failure tripped the circuit.
		const incResult = await sql<{ circuit_failures: number }>`
			UPDATE webhooks
			SET circuit_failures = circuit_failures + 1,
				last_delivery_at = NOW(),
				last_error = ${errText.slice(0, 500)},
				updated_at = NOW()
			WHERE id = ${sub.id}
			RETURNING circuit_failures
		`.execute(tx);
		const newFailures =
			incResult.rows[0]?.circuit_failures ?? sub.circuit_failures + 1;
		const shouldTripCircuit = newFailures >= CIRCUIT_THRESHOLD;

		if (shouldTripCircuit) {
			// Transition to paused only on the first failure that crossed
			// the threshold — additional failures in-flight harmlessly
			// re-set the same fields.
			await tx
				.updateTable("webhooks")
				.set({
					status: "paused",
					circuit_opened_at: new Date(),
					updated_at: new Date(),
				})
				.where("id", "=", sub.id)
				.execute();
			logger.warn(
				"Webhook circuit tripped — paused after consecutive failures",
				{
					webhook: sub.name,
					failures: newFailures,
				},
			);
		}
	});
}

/** What woke this claim cycle — purely for the diagnostic log below; the
 *  claim/dispatch logic itself doesn't branch on it. `"drain-loop"` marks a
 *  pass this function re-ran on itself (see `claimAndDrain`) because a wake
 *  arrived (or the batch cap was hit) while the previous pass was still
 *  dispatching. */
type ClaimTrigger = "notify" | "poll" | "startup" | "drain-loop";

/**
 * The regression this closes: a NOTIFY that arrives while a claim cycle is
 * ALREADY dispatching used to be dropped on the floor (the `claimInFlight`
 * guard below just returned 0), and nothing re-checked once that cycle
 * finished. Rows inserted mid-drain — a normal burst of ~6 chain-webhook
 * matches per block — sat `pending` until an UNRELATED future wake happened
 * to fire, or the 2-minute safety poll, which is exactly the outbox→POST p95
 * tail this was built to catch.
 *
 * The holder of `claimInFlight` now keeps looping (`claimPending`, set by any
 * caller that finds the lock held) until a pass claims nothing NEW and no one
 * asked for a recheck while it ran — so a burst drains fully off one wake
 * instead of needing one wake per claim-sized chunk.
 */
async function claimAndDrain(
	db: Kysely<Database>,
	state: RunningState,
	emitterId: string,
	trigger: ClaimTrigger,
): Promise<number> {
	if (state.claimInFlight) {
		state.claimPending = true;
		return 0;
	}
	state.claimInFlight = true;
	let totalClaimed = 0;
	try {
		let currentTrigger = trigger;
		for (;;) {
			state.claimPending = false;
			const claimedThisPass = await claimAndDispatchOnce(
				db,
				state,
				emitterId,
				currentTrigger,
			);
			totalClaimed += claimedThisPass;
			// Keep going while either: a wake landed mid-pass (claimPending —
			// set by the guard above, from another caller), or this pass hit
			// the batch cap, meaning more rows may still be waiting behind it.
			if (!state.claimPending && claimedThisPass < BATCH_SIZE) break;
			currentTrigger = "drain-loop";
		}
	} finally {
		state.claimInFlight = false;
	}
	return totalClaimed;
}

/** One claim + dispatch pass. Caller (`claimAndDrain`) owns the re-loop and
 *  the `claimInFlight` lock; this is the unit it repeats. */
async function claimAndDispatchOnce(
	db: Kysely<Database>,
	state: RunningState,
	emitterId: string,
	trigger: ClaimTrigger,
): Promise<number> {
	// FOR UPDATE SKIP LOCKED — multiple emitters split the batch.
	// 90/10 live vs replay so a big replay doesn't starve live emits.
	const liveLimit = Math.max(1, Math.round(BATCH_SIZE * LIVE_SHARE));
	const replayLimit = BATCH_SIZE - liveLimit;
	const claimed = await db.transaction().execute(async (tx) => {
		const live = await sql<WebhookOutbox>`
				SELECT * FROM webhook_outbox
				WHERE status = 'pending'
					AND next_attempt_at <= NOW()
					AND is_replay = FALSE
				ORDER BY next_attempt_at ASC
				FOR UPDATE SKIP LOCKED
				LIMIT ${sql.lit(liveLimit)}
			`.execute(tx);
		const replay = await sql<WebhookOutbox>`
				SELECT * FROM webhook_outbox
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
			.updateTable("webhook_outbox")
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
	const bySubId = new Map<string, WebhookOutbox[]>();
	for (const row of claimed) {
		const arr = bySubId.get(row.webhook_id);
		if (arr) arr.push(row);
		else bySubId.set(row.webhook_id, [row]);
	}

	const subIds = Array.from(bySubId.keys());
	const subs = await db
		.selectFrom("webhooks")
		.selectAll()
		.where("id", "in", subIds)
		.execute();
	const subById = new Map(subs.map((s) => [s.id, s]));

	// One line per claim pass: what woke it, how much it found, how stale the
	// oldest row was, and how loaded the in-flight pool already was —
	// everything needed to tell "briefly busy" apart from "actually stuck"
	// without reproducing it live. `in_flight`/`concurrency` sum across only
	// the subs THIS pass touched (a quiet sub's unrelated cap doesn't dilute
	// the reading).
	const oldestCreatedAtMs = Math.min(
		...claimed.map((r) => new Date(r.created_at).getTime()),
	);
	const inFlight = subIds.reduce(
		(sum, id) => sum + (state.inFlightBySub.get(id) ?? 0),
		0,
	);
	const concurrency = subIds.reduce(
		(sum, id) => sum + (subById.get(id)?.concurrency || 4),
		0,
	);
	logger.info("emitter claim cycle", {
		event: "emitter_claim",
		trigger,
		claimed: claimed.length,
		oldest_created_at_age_ms: Date.now() - oldestCreatedAtMs,
		in_flight: inFlight,
		concurrency,
	});

	await Promise.all(
		subIds.map((subId) =>
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			drainForSub(db, state, subById.get(subId)!, bySubId.get(subId)!),
		),
	);

	return claimed.length;
}

async function drainForSub(
	db: Kysely<Database>,
	state: RunningState,
	sub: Webhook,
	rows: WebhookOutbox[],
): Promise<void> {
	if (sub.status !== "active") return;
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
		DELETE FROM webhook_outbox
		WHERE status = 'delivered' AND delivered_at < NOW() - interval '7 days'
	`.execute(db);
	await sql`
		DELETE FROM webhook_deliveries
		WHERE dispatched_at < NOW() - interval '30 days'
	`.execute(db);
	await sql`
		DELETE FROM webhook_outbox
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
		claimPending: false,
	};
	const pollIntervalMs = opts?.pollIntervalMs ?? 120_000;
	const retentionIntervalMs = opts?.retentionIntervalMs ?? 60 * 60_000;

	logger.info("[emitter] started", { id: emitterId });

	// Bootstrap matcher from active subs. Retry with backoff — if this
	// stays broken, fail loud rather than run with an empty matcher (which
	// would silently drop every block's outbox emissions until the next
	// webhook CRUD fired `webhooks:changed`).
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

	// LISTEN on new outbox + sub changes. Both channels fire on the TARGET DB
	// (webhook_outbox + webhooks are control-plane tables), so bind the
	// listener there — under the split it is NOT `DATABASE_URL`.
	const listenUrl = targetListenerUrl();
	const stopNew = await listen(
		"webhooks:new_outbox",
		() => {
			if (!state.running) return;
			void claimAndDrain(db, state, emitterId, "notify").catch((err) =>
				logger.error("[emitter] claim failed", {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		},
		{ connectionString: listenUrl },
	);
	const stopChanged = await listen(
		"webhooks:changed",
		() => {
			if (!state.running) return;
			void refreshMatcher(db).catch((err) =>
				logger.error("[emitter] matcher refresh failed", {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		},
		{ connectionString: listenUrl },
	);
	// Names both channels + the exact host/db LISTENed on (no credentials) so
	// a split-DB misconfiguration — the wake never reaching this process — is
	// visible in `docker logs` at boot, not only inferred from a delivery
	// latency graph later.
	logger.info("[emitter] wake listeners connected", {
		channels: ["webhooks:new_outbox", "webhooks:changed"],
		db: describeDbUrl(listenUrl),
	});

	// Poll every pollIntervalMs as a safety net for missed notifications +
	// backoff wakeups (rows whose next_attempt_at has passed).
	const poll = setInterval(() => {
		if (!state.running) return;
		void claimAndDrain(db, state, emitterId, "poll").catch((err) =>
			logger.error("[emitter] poll claim failed", {
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}, pollIntervalMs);

	// Kick once on startup so any rows that arrived before we started drain.
	void claimAndDrain(db, state, emitterId, "startup");

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
