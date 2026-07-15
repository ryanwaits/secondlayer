import type { Client } from "../../clients/types.ts";
import {
	TransactionAbortedError,
	TransactionDroppedError,
	WaitForTransactionTimeoutError,
} from "../../errors/transaction.ts";
import { getBlockHeight } from "./getBlockHeight.ts";
import {
	type TransactionReceipt,
	type TransactionStatusSource,
	extendedApiSource,
} from "./txSources.ts";

export type WaitForTransactionReceiptParams = {
	txid: string;
	/** Anchor-block confirmations to wait for. Default 1 (mined). */
	confirmations?: number;
	/** Give up after this many ms. Default 180_000 (3 min). */
	timeout?: number;
	/** Delay between status polls, ms. Default 3_000. */
	pollingInterval?: number;
	/**
	 * How long a tx may be unknown to the source before it counts as dropped,
	 * ms. Covers broadcast propagation lag and canonical-only sources that
	 * can't see the mempool. Default 30_000.
	 */
	droppedGracePeriod?: number;
	/** Where to read status from. Defaults to {@link extendedApiSource}. */
	source?: TransactionStatusSource;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until a transaction is mined with N confirmations, then return its
 * receipt.
 *
 * Rejects with {@link TransactionAbortedError} when the tx mines but aborts
 * (`abort_by_response` / `abort_by_post_condition`) — the receipt is attached.
 * Rejects with {@link TransactionDroppedError} when the tx leaves the mempool
 * unmined or stays unknown past `droppedGracePeriod`, and
 * {@link WaitForTransactionTimeoutError} at `timeout`.
 *
 * Reorg-tolerant: every cycle re-reads the receipt (block height may change)
 * and recomputes confirmations from the current tip.
 */
export async function waitForTransactionReceipt(
	client: Client,
	params: WaitForTransactionReceiptParams,
): Promise<TransactionReceipt> {
	const {
		txid,
		confirmations = 1,
		timeout = 180_000,
		pollingInterval = 3_000,
		droppedGracePeriod = 30_000,
	} = params;
	const source = params.source ?? extendedApiSource();

	const startedAt = Date.now();
	let unknownSince: number | null = null;
	let everPending = false;

	while (true) {
		const snapshot = await source.get({ client, txid });
		const receipt = snapshot.receipt;

		if (receipt === null) {
			// Unknown to the source: propagation lag, a canonical-only source
			// looking at a mempool tx, or a genuine drop. Only the grace clock
			// distinguishes them.
			unknownSince ??= Date.now();
			if (Date.now() - unknownSince >= droppedGracePeriod) {
				throw new TransactionDroppedError(
					everPending
						? `Transaction ${txid} left the mempool without being mined`
						: `Transaction ${txid} was never observed by the status source`,
					{ txid },
				);
			}
		} else {
			unknownSince = null;

			switch (receipt.status) {
				case "dropped":
					throw new TransactionDroppedError(
						`Transaction ${txid} was dropped from the mempool`,
						{ txid },
					);
				case "abort_by_response":
				case "abort_by_post_condition":
					throw new TransactionAbortedError(
						`Transaction ${txid} aborted (${receipt.status})`,
						{ receipt },
					);
				case "pending":
					everPending = true;
					break;
				case "success": {
					if (confirmations <= 1) return receipt;
					if (receipt.blockHeight !== undefined) {
						const tip = snapshot.tip ?? (await getBlockHeight(client));
						if (tip - receipt.blockHeight + 1 >= confirmations) return receipt;
					}
					break;
				}
			}
		}

		if (Date.now() - startedAt >= timeout) {
			throw new WaitForTransactionTimeoutError(
				`Timed out after ${timeout}ms waiting for transaction ${txid}`,
				{ txid },
			);
		}
		await sleep(pollingInterval);
	}
}
