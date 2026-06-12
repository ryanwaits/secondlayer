import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { toIndexTxId } from "@secondlayer/shared/x402";
import type { Kysely } from "kysely";

/**
 * Confirmed-tier verification substrate for the x402 rail. Unlike the paginated
 * Index readers (`readFtTransfers`/`readIndexEvents`), which filter by a height
 * range and expose no `tx_id` predicate, this looks a transfer up directly by
 * txid. It gates on `canonical = true`, so it returns a match only once the tx
 * is in a canonical block — i.e. it is a *confirmed-tier* check (the rail blocks
 * on it before serving), not an optimistic/mempool one.
 */

export type X402TransferAsset =
	| { kind: "stx" }
	| { kind: "sip010"; assetIdentifier: string };

export type MatchedTransfer = {
	event_type: "stx_transfer" | "ft_transfer";
	block_height: number;
	tx_id: string;
	contract_id: string | null;
	asset_identifier: string | null;
	sender: string | null;
	recipient: string;
	amount: string;
};

export type VerifyTransferParams = {
	txid: string;
	recipient: string;
	amount: string | bigint;
	asset: X402TransferAsset;
	db?: Kysely<Database>;
};

type Row = {
	event_type: "stx_transfer" | "ft_transfer";
	block_height: string | number;
	tx_id: string;
	contract_id: string | null;
	asset_identifier: string | null;
	sender: string | null;
	recipient: string;
	amount: string;
};

/**
 * Resolve the canonical transfer matching `{txid, recipient, amount, asset}`, or
 * `null` if no such canonical row exists yet (not mined, dropped, reorged out, or
 * any field mismatches). A non-null return is the rail's proof the payment landed
 * exactly as required.
 */
export async function verifyTransferByTxId(
	params: VerifyTransferParams,
): Promise<MatchedTransfer | null> {
	const db = params.db ?? getSourceDb();
	const amount = String(params.amount);
	const eventType =
		params.asset.kind === "stx" ? "stx_transfer" : "ft_transfer";

	const predicates = [
		sql`canonical = true`,
		sql`tx_id = ${toIndexTxId(params.txid)}`,
		sql`event_type = ${eventType}`,
		sql`recipient = ${params.recipient}`,
		sql`amount = ${amount}`,
	];
	if (params.asset.kind === "sip010") {
		predicates.push(sql`asset_identifier = ${params.asset.assetIdentifier}`);
	}

	const { rows } = await sql<Row>`
		SELECT event_type, block_height, tx_id, contract_id, asset_identifier, sender, recipient, amount
		FROM decoded_events
		WHERE ${sql.join(predicates, sql` AND `)}
		LIMIT 1
	`.execute(db);

	const row = rows.at(0);
	if (!row) return null;
	return { ...row, block_height: Number(row.block_height) };
}
