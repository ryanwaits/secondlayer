import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import {
	type X402PaymentRecord,
	type X402PaymentState,
	updateX402PaymentState,
} from "./ledger.ts";

/**
 * Reorg-watch reconciler. Confirmed-tier serves only after a tx is canonical, so
 * the happy path needs no reconciler — this exists solely to catch a *post-serve*
 * reorg: if a previously-`confirmed` payment's tx is no longer a canonical
 * success, the ledger row is flipped to `reverted` (which feeds the abuse
 * signal). Run it on a cron over `confirmed` rows.
 */

export type ReconcileTx = {
	tx_status: string;
	canonical?: boolean;
};

export type ReconcileDeps = {
	getTx?: (txid: string) => Promise<ReconcileTx | null>;
	updateState?: (txid: string, state: X402PaymentState) => Promise<void>;
};

/**
 * Re-check one confirmed payment by txid. Returns the resulting state:
 * `confirmed` if the tx is still a canonical success, `reverted` (and persisted)
 * if it dropped, failed, or was reorged out.
 */
export async function reconcileX402Payment(
	payment: X402PaymentRecord,
	deps: ReconcileDeps = {},
): Promise<X402PaymentState> {
	if (payment.state !== "confirmed") return payment.state;
	const getTx =
		deps.getTx ?? ((txid: string) => new HiroClient().getTransaction(txid));
	const update = deps.updateState ?? updateX402PaymentState;

	const tx = await getTx(payment.txid);
	const stillCanonical =
		tx !== null && tx.tx_status === "success" && tx.canonical !== false;
	if (!stillCanonical) {
		await update(payment.txid, "reverted");
		return "reverted";
	}
	return "confirmed";
}
