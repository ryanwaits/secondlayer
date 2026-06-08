/**
 * x402 post-serve reorg reconciler.
 *
 * Confirmed-tier settlement only serves once a payment tx is canonical, so the
 * request path needs no reconciliation. This sweep exists solely to catch a
 * *post-serve* reorg: a previously-`confirmed` payment whose tx later drops,
 * fails, or is reorged out. Such rows are flipped to `reverted`, which is what
 * `countRevertedByPayer` reads (the abuse/velocity signal).
 *
 * Cheap no-op when the rail is off (the ledger is empty → no Hiro calls).
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb, sql } from "@secondlayer/shared/db";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";

const SWEEP_INTERVAL_MS = 5 * 60_000; // every 5 minutes

export type ReconcileTx = { tx_status: string; canonical?: boolean };

/** A confirmed payment is still valid iff its tx is a canonical success. */
export function isPaymentStillValid(tx: ReconcileTx | null): boolean {
	return tx !== null && tx.tx_status === "success" && tx.canonical !== false;
}

export type SweepDeps = {
	listConfirmedTxids?: () => Promise<string[]>;
	getTx?: (txid: string) => Promise<ReconcileTx | null>;
	markReverted?: (txid: string) => Promise<void>;
};

async function defaultListConfirmedTxids(): Promise<string[]> {
	const rows = await getDb()
		.selectFrom("x402_payments")
		.select("txid")
		.where("state", "=", "confirmed")
		// Only recently-confirmed rows can still reorg; older ones are effectively
		// final (Bitcoin-anchored). Bounds the sweep to a small, recent set.
		.where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
		.execute();
	return rows.map((r) => r.txid);
}

async function defaultMarkReverted(txid: string): Promise<void> {
	await getDb()
		.updateTable("x402_payments")
		.set({ state: "reverted", updated_at: sql`now()` })
		.where("txid", "=", txid)
		.where("state", "=", "confirmed")
		.execute();
}

/** One sweep: re-check each recent confirmed payment, revert the ones whose tx is
 *  no longer a canonical success. Returns counts for logging. */
export async function sweepX402Reconcile(
	deps: SweepDeps = {},
): Promise<{ checked: number; reverted: number }> {
	const listConfirmed = deps.listConfirmedTxids ?? defaultListConfirmedTxids;
	const getTx =
		deps.getTx ?? ((txid: string) => new HiroClient().getTransaction(txid));
	const markReverted = deps.markReverted ?? defaultMarkReverted;

	const txids = await listConfirmed();
	let reverted = 0;
	for (const txid of txids) {
		const tx = await getTx(txid);
		if (!isPaymentStillValid(tx)) {
			await markReverted(txid);
			reverted++;
			logger.warn("x402 payment reverted post-serve (reorg/drop)", { txid });
		}
	}
	return { checked: txids.length, reverted };
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
