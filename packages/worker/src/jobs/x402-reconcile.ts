/**
 * x402 reconciler. Advances the payment ledger for the optimistic-serve path and
 * catches post-serve reorgs:
 *   - `pending` (optimistically served, broadcast) → `confirmed` once the transfer
 *     is canonical, or → `reverted` if it never lands within the grace window
 *     (dropped/reorged).
 *   - `confirmed` → `reverted` if a later reorg orphans it.
 * On any revert it records a per-principal **strike** (Redis, same key the API's
 * optimistic gate reads) so repeat droppers lose optimism. Runs on a cron.
 *
 * Confirmation uses OUR OWN indexed data (`decoded_events`, canonical-gated) — the
 * same substrate the confirmed-tier serve path verifies against — not an external
 * RPC. We're the indexer layer, so the reconciler stays self-contained / Hiro-free.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb, getSourceDb, sql } from "@secondlayer/shared/db";
import {
	X402_STRIKE_TTL_SECONDS,
	toIndexTxId,
	x402StrikeKey,
} from "@secondlayer/shared/x402";
import { RedisClient } from "bun";

const SWEEP_INTERVAL_MS = 5 * 60_000; // every 5 minutes
// A `pending` per-call payment with no canonical transfer after this is treated
// as dropped/reorged. Comfortably past Nakamoto inclusion (~5-29s) + decode lag
// + reorg settling. A never-landing consumption serve should lapse quickly.
const PAYMENT_REVERT_GRACE_MS = 5 * 60_000;
// A `pending` deposit is real customer money that may simply be confirming
// slowly under congestion — writing it off (and striking the payer) after only
// 5 minutes turns normal latency into a permanent loss (it's then excluded from
// `listReconcilable`, so a later canonical confirmation never credits it). Give
// deposits substantially longer before treating them as dropped. Matches the
// `RECONCILE_SCAN_WINDOW` default below so a slow row is never scanned out of
// the window before it can mature into this grace.
const DEPOSIT_REVERT_GRACE_MS = 6 * 60 * 60_000;
// How far back a sweep scans for unsettled rows. Must comfortably exceed a
// confirmed-tier deposit's settle deadline so a slow-confirming deposit row is
// never stranded outside the window before it can confirm+credit. Env-tunable.
const RECONCILE_SCAN_WINDOW =
	process.env.X402_RECONCILE_SCAN_WINDOW ?? "6 hours";

export type ReconcileState = "pending" | "confirmed" | "reverted";
export type ReconcilePayment = {
	txid: string;
	payer: string;
	state: ReconcileState;
	createdAtMs: number;
	/** "payment" (per-call settle) or "deposit" (prepaid top-up). */
	kind: string;
	/** USD-micros to credit on confirmation (deposit rows only; else null). */
	creditUsdMicros: string | null;
	/** When this row's credit was applied (idempotency key), or null if never
	 *  credited (or not credit-bearing). Drives the heal path below. */
	creditedAtMs: number | null;
};

export type ReconcileDeps = {
	/** True iff the payment's transfer is canonical in our index. */
	isCanonical?: (txid: string) => Promise<boolean>;
	/** Flip a pending row → `confirmed`, crediting deposit balances atomically
	 *  (exactly-once, guarded on `state='pending'`). Used for the confirm path. */
	confirmPayment?: (p: ReconcilePayment) => Promise<void>;
	/** Flip a row → `reverted` (reorg / dropped), clawing back any credited
	 *  deposit balance atomically (exactly-once, guarded on the prior state). */
	revertPayment?: (p: ReconcilePayment) => Promise<void>;
	/** Heal a confirmed deposit that was never credited (`credited_at IS
	 *  NULL`) — exactly-once, guarded on `credited_at IS NULL`. Only rows
	 *  created after the credited_at migration are ever eligible (pre-existing
	 *  confirmed deposits were backfilled to a non-null sentinel). */
	healCredit?: (p: ReconcilePayment) => Promise<void>;
	recordStrike?: (principal: string) => Promise<void>;
	now?: () => number;
	graceMs?: number;
};

/**
 * USD-micros to credit when a payment confirms. Only deposit rows carrying a
 * persisted amount credit a balance; per-call settles credit nothing. Pure so
 * the credit decision is unit-testable without a DB.
 */
export function depositCreditMicros(
	kind: string,
	creditUsdMicros: string | null,
): bigint | null {
	if (kind !== "deposit" || !creditUsdMicros) return null;
	const micros = BigInt(creditUsdMicros);
	return micros > 0n ? micros : null;
}

/**
 * Re-check one payment. Canonical → `confirmed` (crediting deposits). Not
 * canonical and either already `confirmed` (reorged out) or past the grace
 * window (`pending` that never landed) → `reverted` (+ clawback of any
 * credited deposit balance). Otherwise left `pending` (still settling).
 *
 * A revert only takes a strike when it reflects an actual optimism failure:
 * a `payment` that never landed, or a genuine reorg (`state === "confirmed"`
 * — it WAS canonical, now it isn't). A `pending` deposit that merely aged out
 * (never proven non-canonical) was never proven dropped, so the payer isn't
 * penalized for it — see the aged-out log below for the operator-visible trace.
 */
export async function reconcilePayment(
	p: ReconcilePayment,
	deps: ReconcileDeps = {},
): Promise<ReconcileState> {
	const isCanonical = deps.isCanonical ?? defaultIsCanonical;
	const confirmPayment = deps.confirmPayment ?? defaultConfirmPayment;
	const revertPayment = deps.revertPayment ?? defaultRevertPayment;
	const healCredit = deps.healCredit ?? defaultHealCredit;
	const recordStrike = deps.recordStrike ?? defaultRecordStrike;
	const now = deps.now ?? (() => Date.now());
	const defaultGraceMs =
		p.kind === "deposit" ? DEPOSIT_REVERT_GRACE_MS : PAYMENT_REVERT_GRACE_MS;
	const graceMs = deps.graceMs ?? defaultGraceMs;

	if (await isCanonical(p.txid)) {
		if (p.state !== "confirmed") {
			await confirmPayment(p);
		} else if (
			p.creditedAtMs === null &&
			depositCreditMicros(p.kind, p.creditUsdMicros) !== null
		) {
			// Genuinely-uncredited confirmed deposit (post-migration row only —
			// pre-existing confirmed deposits were backfilled to a non-null
			// credited_at sentinel and can never reach this branch). Heal it.
			await healCredit(p);
		}
		return "confirmed";
	}

	const age = now() - p.createdAtMs;
	const matured = age > graceMs;
	const reorged = p.state === "confirmed";
	if (reorged || matured) {
		await revertPayment(p);
		const agedOutDeposit = !reorged && matured && p.kind === "deposit";
		if (!agedOutDeposit) await recordStrike(p.payer);
		if (agedOutDeposit) {
			// Distinct, greppable signal: this is the only trace an operator has
			// that a customer's deposit was written off without proof it dropped.
			logger.warn("x402 deposit aged out", {
				event: "x402_deposit_aged_out",
				txid: p.txid,
				payer: p.payer,
				ageMs: age,
			});
		} else {
			logger.warn("x402 payment reverted", {
				txid: p.txid,
				payer: p.payer,
				was: p.state,
			});
		}
		return "reverted";
	}
	return "pending"; // still within grace — give it time to mine
}

/**
 * True iff a revert of this payment must claw back a previously credited
 * deposit balance: only a row that actually reached `confirmed` with a
 * positive deposit credit was ever credited. A `pending` revert (never
 * landed) or a `payment`-kind/zero-credit row credited nothing. Pure so the
 * money-critical decision is unit-testable without a DB.
 */
export function shouldDebitOnRevert(p: ReconcilePayment): boolean {
	return (
		p.state === "confirmed" &&
		depositCreditMicros(p.kind, p.creditUsdMicros) !== null
	);
}

/** Canonical iff a transfer event for this txid exists in our index (decoded by
 *  the L2 pipeline, canonical-gated). Source plane (chain/decoded). */
async function defaultIsCanonical(txid: string): Promise<boolean> {
	const { rows } = await sql<{ one: number }>`
		SELECT 1 AS one
		FROM decoded_events
		WHERE tx_id = ${toIndexTxId(txid)}
			AND canonical = true
			AND event_type IN ('stx_transfer', 'ft_transfer')
		LIMIT 1
	`.execute(getSourceDb());
	return rows.length > 0;
}

// Keep IN-list parameter counts bounded for large sweeps.
const CANONICAL_QUERY_CHUNK_SIZE = 1000;

/**
 * Resolve canonicality for a whole batch of payment txids in one query (chunked
 * for very large sweeps) instead of one query per payment. Returns the set of
 * **payment** txids (not the mapped index tx_id form) that are canonical.
 */
async function canonicalTxidSet(txids: string[]): Promise<Set<string>> {
	if (txids.length === 0) return new Set();

	// index tx_id -> original payment txid, so results map back correctly.
	const byIndexId = new Map<string, string>();
	for (const txid of txids) byIndexId.set(toIndexTxId(txid), txid);
	const indexIds = [...byIndexId.keys()];

	const canonical = new Set<string>();
	for (let i = 0; i < indexIds.length; i += CANONICAL_QUERY_CHUNK_SIZE) {
		const chunk = indexIds.slice(i, i + CANONICAL_QUERY_CHUNK_SIZE);
		const rows = await getSourceDb()
			.selectFrom("decoded_events")
			.select("tx_id")
			.distinct()
			.where("tx_id", "in", chunk)
			.where("canonical", "=", true)
			.where("event_type", "in", ["stx_transfer", "ft_transfer"])
			.execute();
		for (const row of rows) {
			const paymentTxid = byIndexId.get(row.tx_id);
			if (paymentTxid) canonical.add(paymentTxid);
		}
	}
	return canonical;
}

/**
 * Revert a payment, clawing back any credited deposit balance in the SAME
 * transaction as the state flip so a crash can never revert-without-debiting.
 * The flip is guarded on the row's prior state, so concurrent sweeps debit at
 * most once: only the call that actually transitions the row
 * (numUpdatedRows === 1) debits. Negative balances are allowed on purpose —
 * if the payer already spent the credit, the debit takes them below zero
 * (an honest ledger); clamping at zero would silently forgive spent-then-
 * reverted credit.
 */
async function defaultRevertPayment(p: ReconcilePayment): Promise<void> {
	if (!shouldDebitOnRevert(p)) {
		await getDb()
			.updateTable("x402_payments")
			.set({ state: "reverted", updated_at: sql`now()` })
			.where("txid", "=", p.txid)
			.where("state", "in", ["pending", "confirmed"])
			.execute();
		return;
	}

	const micros = depositCreditMicros(p.kind, p.creditUsdMicros);
	if (micros === null) return; // unreachable given shouldDebitOnRevert, but keeps TS narrow

	await getDb()
		.transaction()
		.execute(async (trx) => {
			const res = await trx
				.updateTable("x402_payments")
				.set({ state: "reverted", updated_at: sql`now()` })
				.where("txid", "=", p.txid)
				.where("state", "=", "confirmed")
				.executeTakeFirst();
			// Another sweep already reverted it → don't double-debit.
			if (Number(res.numUpdatedRows ?? 0n) !== 1) return;
			await trx
				.updateTable("x402_balances")
				.set({
					balance_usd_micros: sql`x402_balances.balance_usd_micros - ${micros.toString()}`,
					updated_at: new Date(),
				})
				.where("principal", "=", p.payer)
				.execute();
		});
}

/**
 * Confirm a pending payment, crediting deposit balances in the SAME transaction
 * as the state flip so a crash can never confirm-without-crediting. The flip is
 * guarded on `state='pending'`, so concurrent sweeps credit at most once: only
 * the call that actually transitions the row (numUpdatedRows === 1) credits.
 * Mirrors `creditBalance` in `@secondlayer/api/x402/balance` (worker can't import
 * the API package, so the x402_balances upsert is replicated here).
 */
async function defaultConfirmPayment(p: ReconcilePayment): Promise<void> {
	const micros = depositCreditMicros(p.kind, p.creditUsdMicros);
	if (micros === null) {
		await getDb()
			.updateTable("x402_payments")
			.set({ state: "confirmed", updated_at: sql`now()` })
			.where("txid", "=", p.txid)
			.where("state", "=", "pending")
			.execute();
		return;
	}

	await getDb()
		.transaction()
		.execute(async (trx) => {
			const res = await trx
				.updateTable("x402_payments")
				.set({
					state: "confirmed",
					updated_at: sql`now()`,
					credited_at: sql`now()`,
				})
				.where("txid", "=", p.txid)
				.where("state", "=", "pending")
				.executeTakeFirst();
			// Another sweep already confirmed it → don't double-credit.
			if (Number(res.numUpdatedRows ?? 0n) !== 1) return;
			await trx
				.insertInto("x402_balances")
				.values({
					principal: p.payer,
					balance_usd_micros: micros.toString(),
					updated_at: new Date(),
				})
				.onConflict((oc) =>
					oc.column("principal").doUpdateSet({
						balance_usd_micros: sql`x402_balances.balance_usd_micros + ${micros.toString()}`,
						updated_at: new Date(),
					}),
				)
				.execute();
		});
}

/**
 * Heal a confirmed deposit whose credit was never applied — a confirmed row
 * with `credited_at IS NULL` created after the credited_at migration (see
 * 0108_x402_payments_credited_at.ts). Pre-existing confirmed deposits were
 * backfilled to a non-null sentinel and are never eligible here, so this can
 * only ever touch a genuinely-uncredited post-migration row. Guarded on
 * `state='confirmed' AND credited_at IS NULL` in the SAME transaction as the
 * credit, so concurrent sweeps heal at most once (numUpdatedRows === 1).
 */
async function defaultHealCredit(p: ReconcilePayment): Promise<void> {
	await getDb()
		.transaction()
		.execute(async (trx) => {
			const res = await trx
				.updateTable("x402_payments")
				.set({ credited_at: sql`now()`, updated_at: sql`now()` })
				.where("txid", "=", p.txid)
				.where("state", "=", "confirmed")
				.where("credited_at", "is", null)
				.executeTakeFirst();
			// Another sweep already healed it → don't double-credit.
			if (Number(res.numUpdatedRows ?? 0n) !== 1) return;
			const micros = depositCreditMicros(p.kind, p.creditUsdMicros);
			if (micros === null) return;
			await trx
				.insertInto("x402_balances")
				.values({
					principal: p.payer,
					balance_usd_micros: micros.toString(),
					updated_at: new Date(),
				})
				.onConflict((oc) =>
					oc.column("principal").doUpdateSet({
						balance_usd_micros: sql`x402_balances.balance_usd_micros + ${micros.toString()}`,
						updated_at: new Date(),
					}),
				)
				.execute();
		});
}

let redis: RedisClient | null = null;
function getRedis(): RedisClient | null {
	if (redis) return redis;
	if (!process.env.REDIS_URL) return null;
	redis = new RedisClient(process.env.REDIS_URL);
	return redis;
}

async function defaultRecordStrike(principal: string): Promise<void> {
	const r = getRedis();
	if (!r) return; // no Redis (dev) → strikes are a no-op
	try {
		const key = x402StrikeKey(principal);
		await r.send("INCR", [key]);
		await r.send("EXPIRE", [key, String(X402_STRIKE_TTL_SECONDS)]);
	} catch {
		// best-effort
	}
}

async function listReconcilable(): Promise<ReconcilePayment[]> {
	const rows = await getDb()
		.selectFrom("x402_payments")
		.select([
			"txid",
			"payer",
			"state",
			"created_at",
			"kind",
			"credit_usd_micros",
			"credited_at",
		])
		.where("state", "in", ["pending", "confirmed"])
		.where(
			"created_at",
			">",
			sql<Date>`now() - ${RECONCILE_SCAN_WINDOW}::interval`,
		)
		.execute();
	return rows.map((r) => ({
		txid: r.txid,
		payer: r.payer,
		state: r.state as ReconcileState,
		createdAtMs: new Date(r.created_at).getTime(),
		kind: r.kind,
		creditUsdMicros: r.credit_usd_micros,
		creditedAtMs: r.credited_at ? new Date(r.credited_at).getTime() : null,
	}));
}

export type SweepDeps = ReconcileDeps & {
	list?: () => Promise<ReconcilePayment[]>;
	/** Resolve canonicality for the whole batch in one call. Feeds
	 *  `reconcilePayment`'s `isCanonical` for the sweep, UNLESS the caller
	 *  already injected its own `isCanonical` (that always wins). Defaults to
	 *  a single batched (chunked) DB query instead of one query per payment. */
	resolveCanonicalSet?: (txids: string[]) => Promise<Set<string>>;
};

/** One sweep over recent pending/confirmed payments. Returns counts for logging. */
export async function sweepX402Reconcile(
	deps: SweepDeps = {},
): Promise<{ checked: number; confirmed: number; reverted: number }> {
	const list = deps.list ?? listReconcilable;
	const resolveCanonicalSet = deps.resolveCanonicalSet ?? canonicalTxidSet;
	const payments = await list();
	let confirmed = 0;
	let reverted = 0;

	// Resolve canonicality for the whole batch in one shot, unless the caller
	// injected a per-payment `isCanonical` (respected as-is, e.g. in tests).
	let sweepDeps: ReconcileDeps = deps;
	if (!deps.isCanonical) {
		const canon = await resolveCanonicalSet(payments.map((p) => p.txid));
		sweepDeps = { ...deps, isCanonical: async (txid) => canon.has(txid) };
	}

	for (const p of payments) {
		const next = await reconcilePayment(p, sweepDeps);
		if (next === "confirmed" && p.state !== "confirmed") confirmed++;
		if (next === "reverted") reverted++;
	}
	return { checked: payments.length, confirmed, reverted };
}

export function startX402ReconcileCron(): () => void {
	const tick = async () => {
		try {
			const result = await sweepX402Reconcile();
			if (result.checked > 0) logger.info("x402 reconcile sweep", result);
		} catch (err) {
			logger.error("x402 reconcile cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 30_000);
	const interval = setInterval(tick, SWEEP_INTERVAL_MS);
	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
