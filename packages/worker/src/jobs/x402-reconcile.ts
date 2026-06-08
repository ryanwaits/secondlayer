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
	x402StrikeKey,
} from "@secondlayer/shared/x402";
import { RedisClient } from "bun";

const SWEEP_INTERVAL_MS = 5 * 60_000; // every 5 minutes
// A `pending` tx with no canonical transfer after this is treated as dropped/
// reorged. Comfortably past Nakamoto inclusion (~5-29s) + decode lag + reorg settling.
const REVERT_GRACE_MS = 5 * 60_000;

export type ReconcileState = "pending" | "confirmed" | "reverted";
export type ReconcilePayment = {
	txid: string;
	payer: string;
	state: ReconcileState;
	createdAtMs: number;
};

export type ReconcileDeps = {
	/** True iff the payment's transfer is canonical in our index. */
	isCanonical?: (txid: string) => Promise<boolean>;
	updateState?: (
		txid: string,
		state: "confirmed" | "reverted",
	) => Promise<void>;
	recordStrike?: (principal: string) => Promise<void>;
	now?: () => number;
	graceMs?: number;
};

/**
 * Re-check one payment. Canonical → `confirmed`. Not canonical and either already
 * `confirmed` (reorged out) or past the grace window (`pending` that never landed)
 * → `reverted` (+ strike). Otherwise left `pending` (still settling).
 */
export async function reconcilePayment(
	p: ReconcilePayment,
	deps: ReconcileDeps = {},
): Promise<ReconcileState> {
	const isCanonical = deps.isCanonical ?? defaultIsCanonical;
	const updateState = deps.updateState ?? defaultUpdateState;
	const recordStrike = deps.recordStrike ?? defaultRecordStrike;
	const now = deps.now ?? (() => Date.now());
	const graceMs = deps.graceMs ?? REVERT_GRACE_MS;

	if (await isCanonical(p.txid)) {
		if (p.state !== "confirmed") await updateState(p.txid, "confirmed");
		return "confirmed";
	}

	const matured = now() - p.createdAtMs > graceMs;
	if (p.state === "confirmed" || matured) {
		await updateState(p.txid, "reverted");
		await recordStrike(p.payer);
		logger.warn("x402 payment reverted", {
			txid: p.txid,
			payer: p.payer,
			was: p.state,
		});
		return "reverted";
	}
	return "pending"; // still within grace — give it time to mine
}

/** Canonical iff a transfer event for this txid exists in our index (decoded by
 *  the L2 pipeline, canonical-gated). Source plane (chain/decoded). */
async function defaultIsCanonical(txid: string): Promise<boolean> {
	const { rows } = await sql<{ one: number }>`
		SELECT 1 AS one
		FROM decoded_events
		WHERE tx_id = ${txid}
			AND canonical = true
			AND event_type IN ('stx_transfer', 'ft_transfer')
		LIMIT 1
	`.execute(getSourceDb());
	return rows.length > 0;
}

async function defaultUpdateState(
	txid: string,
	state: "confirmed" | "reverted",
): Promise<void> {
	await getDb()
		.updateTable("x402_payments")
		.set({ state, updated_at: sql`now()` })
		.where("txid", "=", txid)
		.execute();
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
		.select(["txid", "payer", "state", "created_at"])
		.where("state", "in", ["pending", "confirmed"])
		.where("created_at", ">", sql<Date>`now() - interval '2 hours'`)
		.execute();
	return rows.map((r) => ({
		txid: r.txid,
		payer: r.payer,
		state: r.state as ReconcileState,
		createdAtMs: new Date(r.created_at).getTime(),
	}));
}

export type SweepDeps = ReconcileDeps & {
	list?: () => Promise<ReconcilePayment[]>;
};

/** One sweep over recent pending/confirmed payments. Returns counts for logging. */
export async function sweepX402Reconcile(
	deps: SweepDeps = {},
): Promise<{ checked: number; confirmed: number; reverted: number }> {
	const list = deps.list ?? listReconcilable;
	const payments = await list();
	let confirmed = 0;
	let reverted = 0;
	for (const p of payments) {
		const next = await reconcilePayment(p, deps);
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
