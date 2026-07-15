import type { Client } from "../../clients/types.ts";
import {
	type TransactionReceipt,
	type TransactionStatusSource,
	extendedApiSource,
} from "./txSources.ts";

export type GetTransactionParams = {
	txid: string;
	/** Where to read status from. Defaults to {@link extendedApiSource}. */
	source?: TransactionStatusSource;
};

/**
 * Fetch a transaction's receipt (status, block info, decoded result).
 * Returns `null` when the source has no record of the transaction.
 */
export async function getTransaction(
	client: Client,
	params: GetTransactionParams,
): Promise<TransactionReceipt | null> {
	const source = params.source ?? extendedApiSource();
	const { receipt } = await source.get({ client, txid: params.txid });
	return receipt;
}
