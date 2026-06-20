import { getSourceDb } from "@secondlayer/shared/db";
import type {
	SbtcEventTopic,
	SbtcTokenEventType,
} from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { writeDecoderCheckpoint } from "./storage.ts";

export const SBTC_DECODER_NAME = "decode.sbtc.v1";
export const SBTC_TOKEN_DECODER_NAME = "decode.sbtc_token.v1";

export type SbtcEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
	request_id: number | null;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	bitcoin_txid: string | null;
	output_index: number | null;
	sweep_txid: string | null;
	burn_hash: string | null;
	burn_height: number | null;
	signer_bitmap: string | null;
	max_fee: string | null;
	fee: string | null;
	block_height_at_request: number | null;
	governance_contract_type: number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: number | null;
	signer_address: string | null;
	signer_keys_count: number | null;
	source_cursor: string;
};

export type SbtcTokenEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: SbtcTokenEventType;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
	source_cursor: string;
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

export async function writeSbtcEvents(
	rows: SbtcEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("sbtc_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				topic: eb.ref("excluded.topic"),
				request_id: eb.ref("excluded.request_id"),
				amount: eb.ref("excluded.amount"),
				sender: eb.ref("excluded.sender"),
				recipient_btc_version: eb.ref("excluded.recipient_btc_version"),
				recipient_btc_hashbytes: eb.ref("excluded.recipient_btc_hashbytes"),
				bitcoin_txid: eb.ref("excluded.bitcoin_txid"),
				output_index: eb.ref("excluded.output_index"),
				sweep_txid: eb.ref("excluded.sweep_txid"),
				burn_hash: eb.ref("excluded.burn_hash"),
				burn_height: eb.ref("excluded.burn_height"),
				signer_bitmap: eb.ref("excluded.signer_bitmap"),
				max_fee: eb.ref("excluded.max_fee"),
				fee: eb.ref("excluded.fee"),
				block_height_at_request: eb.ref("excluded.block_height_at_request"),
				governance_contract_type: eb.ref("excluded.governance_contract_type"),
				governance_new_contract: eb.ref("excluded.governance_new_contract"),
				signer_aggregate_pubkey: eb.ref("excluded.signer_aggregate_pubkey"),
				signer_threshold: eb.ref("excluded.signer_threshold"),
				signer_address: eb.ref("excluded.signer_address"),
				signer_keys_count: eb.ref("excluded.signer_keys_count"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

export async function writeSbtcTokenEvents(
	rows: SbtcTokenEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("sbtc_token_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				event_type: eb.ref("excluded.event_type"),
				sender: eb.ref("excluded.sender"),
				recipient: eb.ref("excluded.recipient"),
				amount: eb.ref("excluded.amount"),
				memo: eb.ref("excluded.memo"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

/**
 * Reconcile the sBTC planes on reorg. Mirrors `handleDecodedEventsReorg`
 * (storage.ts): hard-DELETE at/above the fork, NOT a canonical=false flag.
 *
 * Both tables key on `cursor` = block_height:stream_event_index, a DENSE
 * per-block ordinal recomputed by readCanonicalStreamsEvents, and their writers
 * upsert on `cursor` with `canonical=true` hard-coded. So a post-reorg re-decode
 * lands on SHIFTED cursors and inserts ALONGSIDE the old-fork rows; a flag-only
 * mark gets resurrected by a later range re-derive (the 2026-05-26 reorg left 5
 * stale sBTC rows exactly this way). The sBTC decoders own these tables, so an
 * unscoped delete-by-height is correct. Runs inside the leader-gated reorg tx;
 * each decoder's checkpoint is rewound to the last source event it processed
 * before the fork so it re-derives the new fork from a clean slate.
 */
export async function handleSbtcReorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database> },
): Promise<{ deleted: number; checkpoints: Record<string, string | null> }> {
	const client = db(opts?.db);

	const eventsResult = await client
		.deleteFrom("sbtc_events")
		.where("block_height", ">=", blockHeight)
		.executeTakeFirst();

	const tokenResult = await client
		.deleteFrom("sbtc_token_events")
		.where("block_height", ">=", blockHeight)
		.executeTakeFirst();

	// Each table maps to its own decoder/checkpoint; rewind both.
	const registryCheckpoint =
		(
			await client
				.selectFrom("sbtc_events")
				.select("source_cursor")
				.where("block_height", "<", blockHeight)
				.orderBy("block_height", "desc")
				.orderBy("event_index", "desc")
				.limit(1)
				.executeTakeFirst()
		)?.source_cursor ?? null;
	const tokenCheckpoint =
		(
			await client
				.selectFrom("sbtc_token_events")
				.select("source_cursor")
				.where("block_height", "<", blockHeight)
				.orderBy("block_height", "desc")
				.orderBy("event_index", "desc")
				.limit(1)
				.executeTakeFirst()
		)?.source_cursor ?? null;
	await writeDecoderCheckpoint({
		cursor: registryCheckpoint,
		db: opts?.db,
		decoderName: SBTC_DECODER_NAME,
	});
	await writeDecoderCheckpoint({
		cursor: tokenCheckpoint,
		db: opts?.db,
		decoderName: SBTC_TOKEN_DECODER_NAME,
	});

	return {
		deleted:
			Number(eventsResult.numDeletedRows ?? 0) +
			Number(tokenResult.numDeletedRows ?? 0),
		checkpoints: {
			[SBTC_DECODER_NAME]: registryCheckpoint,
			[SBTC_TOKEN_DECODER_NAME]: tokenCheckpoint,
		},
	};
}
