import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely, RawBuilder } from "kysely";

/**
 * NFT transfer list item. value is our decoded string token id — do not
 * fabricate Hiro { hex, repr }. nft_transfer only (nft_mint deferred).
 */
export type ExtendedNftTransfer = {
	sender: string | null;
	recipient: string | null;
	asset_identifier: string;
	value: string | null;
	tx_id: string;
	block_height: number;
	event_index: number;
	asset_event_type: "transfer";
};

export type ListExtendedNftTransfersQuery = {
	limit: number;
	offset: number;
	assetIdentifier?: string;
};

export type ListExtendedNftTransfersResult = {
	results: ExtendedNftTransfer[];
	total: number;
};

export type ListExtendedNftTransfers = (
	q: ListExtendedNftTransfersQuery,
) => Promise<ListExtendedNftTransfersResult>;

type NftTransferRow = {
	sender: string | null;
	recipient: string | null;
	asset_identifier: string;
	value: string | null;
	tx_id: string;
	block_height: number | string;
	event_index: number | string;
};

function projectNftTransfer(row: NftTransferRow): ExtendedNftTransfer {
	return {
		sender: row.sender,
		recipient: row.recipient,
		asset_identifier: row.asset_identifier,
		value: row.value,
		tx_id: row.tx_id,
		block_height: Number(row.block_height),
		event_index: Number(row.event_index),
		asset_event_type: "transfer",
	};
}

/** Canonical nft_transfer rows, height desc then event_index desc. */
export async function listExtendedNftTransfers(
	q: ListExtendedNftTransfersQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedNftTransfersResult> {
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`event_type = ${"nft_transfer"}`,
	];
	if (q.assetIdentifier !== undefined && q.assetIdentifier !== "") {
		predicates.push(sql`asset_identifier = ${q.assetIdentifier}`);
	}

	const { rows: countRows } = await sql<{ count: string | number }>`
		SELECT COUNT(*)::bigint AS count
		FROM decoded_events
		WHERE ${sql.join(predicates, sql` AND `)}
	`.execute(db);
	const total = Number(countRows[0]?.count ?? 0);

	const { rows } = await sql<NftTransferRow>`
		SELECT
			sender,
			recipient,
			asset_identifier,
			value,
			tx_id,
			block_height,
			event_index
		FROM decoded_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height DESC, event_index DESC
		LIMIT ${q.limit}
		OFFSET ${q.offset}
	`.execute(db);

	return {
		results: rows.map(projectNftTransfer),
		total,
	};
}
