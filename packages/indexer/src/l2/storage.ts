import type { DecodedEventColumns, DecodedEventRow } from "@secondlayer/sdk";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Generated, Kysely } from "kysely";

export const FT_TRANSFER_DECODER_NAME = "l2.ft_transfer.v1";
export const NFT_TRANSFER_DECODER_NAME = "l2.nft_transfer.v1";
export const STX_TRANSFER_DECODER_NAME = "l2.stx_transfer.v1";
export const STX_MINT_DECODER_NAME = "l2.stx_mint.v1";
export const STX_BURN_DECODER_NAME = "l2.stx_burn.v1";
export const STX_LOCK_DECODER_NAME = "l2.stx_lock.v1";
export const FT_MINT_DECODER_NAME = "l2.ft_mint.v1";
export const FT_BURN_DECODER_NAME = "l2.ft_burn.v1";
export const NFT_MINT_DECODER_NAME = "l2.nft_mint.v1";
export const NFT_BURN_DECODER_NAME = "l2.nft_burn.v1";
export const PRINT_DECODER_NAME = "l2.print.v1";

export const L2_DECODER_NAMES = [
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	STX_TRANSFER_DECODER_NAME,
	STX_MINT_DECODER_NAME,
	STX_BURN_DECODER_NAME,
	STX_LOCK_DECODER_NAME,
	FT_MINT_DECODER_NAME,
	FT_BURN_DECODER_NAME,
	NFT_MINT_DECODER_NAME,
	NFT_BURN_DECODER_NAME,
	PRINT_DECODER_NAME,
] as const;

export type L2DecoderName = (typeof L2_DECODER_NAMES)[number];

export const L2_DECODER_EVENT_TYPES: Record<L2DecoderName, string> = {
	[FT_TRANSFER_DECODER_NAME]: "ft_transfer",
	[NFT_TRANSFER_DECODER_NAME]: "nft_transfer",
	[STX_TRANSFER_DECODER_NAME]: "stx_transfer",
	[STX_MINT_DECODER_NAME]: "stx_mint",
	[STX_BURN_DECODER_NAME]: "stx_burn",
	[STX_LOCK_DECODER_NAME]: "stx_lock",
	[FT_MINT_DECODER_NAME]: "ft_mint",
	[FT_BURN_DECODER_NAME]: "ft_burn",
	[NFT_MINT_DECODER_NAME]: "nft_mint",
	[NFT_BURN_DECODER_NAME]: "nft_burn",
	[PRINT_DECODER_NAME]: "print",
};

// Returns ft+nft (always on) plus sbtc/pox4/bns conditional on env flags.
// Both indexer and api containers read the same docker .env, so this view is
// consistent across processes. Used as the default for `getL2DecodersHealth`
// so /public/status reports every enabled decoder, not just the hardcoded two.
export function getEnabledL2DecoderNames(
	env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
	const names: string[] = [
		FT_TRANSFER_DECODER_NAME,
		NFT_TRANSFER_DECODER_NAME,
		STX_TRANSFER_DECODER_NAME,
		STX_MINT_DECODER_NAME,
		STX_BURN_DECODER_NAME,
		STX_LOCK_DECODER_NAME,
		FT_MINT_DECODER_NAME,
		FT_BURN_DECODER_NAME,
		NFT_MINT_DECODER_NAME,
		NFT_BURN_DECODER_NAME,
		PRINT_DECODER_NAME,
	];
	// String literals here (not imports) to keep storage.ts free of cycles
	// with sbtc-/pox4-/bns-storage.ts; the canonical defs live in those files.
	// sbtc and pox4 default to enabled (see service.ts / isPox4DecoderEnabled) —
	// only suppressed via explicit `*_DECODER_ENABLED=false`. Read the injected
	// `env` (not global process.env) so this stays testable and consistent, and
	// so /public/status surfaces the same decoder set the indexer actually runs.
	if (env.SBTC_DECODER_ENABLED !== "false") {
		names.push("l2.sbtc.v1", "l2.sbtc_token.v1");
	}
	if (env.POX4_DECODER_ENABLED !== "false") names.push("l2.pox4.v1");
	if (env.BNS_DECODER_ENABLED === "true") names.push("l2.bns.v1");
	return names;
}

type L2Database = Database & {
	decoded_events: {
		cursor: string;
		block_height: number;
		tx_id: string;
		tx_index: number;
		event_index: number;
		event_type: string;
		microblock_hash: string | null;
		canonical: Generated<boolean>;
		contract_id: string | null;
		sender: string | null;
		recipient: string | null;
		amount: string | null;
		asset_identifier: string | null;
		value: string | null;
		memo: string | null;
		payload: string | null;
		source_cursor: string;
		created_at: Generated<Date>;
	};
	l2_decoder_checkpoints: {
		decoder_name: string;
		last_cursor: string | null;
		updated_at: Generated<Date>;
	};
};

function l2Db(db?: Kysely<Database>): Kysely<L2Database> {
	return (db ?? getSourceDb()) as unknown as Kysely<L2Database>;
}

export async function readDecoderCheckpoint(opts?: {
	db?: Kysely<Database>;
	decoderName?: string;
}): Promise<string | null> {
	const db = l2Db(opts?.db);
	const row = await db
		.selectFrom("l2_decoder_checkpoints")
		.select("last_cursor")
		.where("decoder_name", "=", opts?.decoderName ?? FT_TRANSFER_DECODER_NAME)
		.executeTakeFirst();
	return row?.last_cursor ?? null;
}

export async function writeDecoderCheckpoint(opts: {
	cursor: string | null;
	db?: Kysely<Database>;
	decoderName?: string;
}): Promise<void> {
	const db = l2Db(opts.db);
	const decoderName = opts.decoderName ?? FT_TRANSFER_DECODER_NAME;

	await db
		.insertInto("l2_decoder_checkpoints")
		.values({
			decoder_name: decoderName,
			last_cursor: opts.cursor,
		})
		.onConflict((oc) =>
			oc.column("decoder_name").doUpdateSet({
				last_cursor: opts.cursor,
				updated_at: new Date(),
			}),
		)
		.execute();
}

/**
 * Bump `updated_at` on a decoder checkpoint without touching `last_cursor`.
 * Used as a liveness signal — the runDecoder loop calls this every poll so
 * the health endpoint can tell "decoder process alive but no new work" apart
 * from "decoder process stuck/crashed."
 */
export async function bumpDecoderCheckpoint(opts: {
	db?: Kysely<Database>;
	decoderName: string;
}): Promise<void> {
	const db = l2Db(opts.db);
	await db
		.updateTable("l2_decoder_checkpoints")
		.set({ updated_at: new Date() })
		.where("decoder_name", "=", opts.decoderName)
		.execute();
}

export async function writeDecodedEvents(
	events: readonly DecodedEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (events.length === 0) return;

	// De-dupe by cursor before the upsert. A single batch can carry two events
	// that resolve to the same Streams cursor when a reorged height has stale
	// duplicate transactions (the Streams stream_event_index counts events
	// joined to transactions, which double-counts orphaned tx rows). `cursor` is
	// this table's conflict key, so Postgres rejects the whole batch otherwise —
	// "ON CONFLICT DO UPDATE command cannot affect row a second time" — and the
	// decoder wedges. Last occurrence wins.
	const byCursor = new Map<string, DecodedEventRow>();
	for (const event of events) byCursor.set(event.cursor, event);
	const deduped = [...byCursor.values()];

	const db = l2Db(opts?.db);
	await db
		.insertInto("decoded_events")
		.values(
			deduped.map((event) => {
				// Every decoded payload is a subset of DecodedEventColumns, so columns
				// map generically — the decoder decides which fields a given event
				// type populates; absent ones fall to null.
				const payload = event.decoded_payload as DecodedEventColumns;
				return {
					cursor: event.cursor,
					block_height: event.block_height,
					tx_id: event.tx_id,
					tx_index: event.tx_index,
					event_index: event.event_index,
					event_type: event.event_type,
					contract_id: payload.contract_id ?? null,
					sender: payload.sender ?? null,
					recipient: payload.recipient ?? null,
					amount: payload.amount ?? null,
					asset_identifier: payload.asset_identifier ?? null,
					value: payload.value ?? null,
					memo: payload.memo ?? null,
					payload:
						payload.payload != null ? JSON.stringify(payload.payload) : null,
					source_cursor: event.source_cursor,
				};
			}),
		)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				event_type: eb.ref("excluded.event_type"),
				microblock_hash: eb.ref("excluded.microblock_hash"),
				canonical: true,
				contract_id: eb.ref("excluded.contract_id"),
				sender: eb.ref("excluded.sender"),
				recipient: eb.ref("excluded.recipient"),
				amount: eb.ref("excluded.amount"),
				asset_identifier: eb.ref("excluded.asset_identifier"),
				value: eb.ref("excluded.value"),
				memo: eb.ref("excluded.memo"),
				payload: eb.ref("excluded.payload"),
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

export async function handleDecodedEventsReorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database>; decoderNames?: readonly L2DecoderName[] },
): Promise<{
	deleted: number;
	checkpoints: Record<L2DecoderName, string | null>;
	checkpoint: string | null;
}> {
	const db = l2Db(opts?.db);
	const decoderNames = opts?.decoderNames ?? L2_DECODER_NAMES;

	// Hard-DELETE every decoded row at/above the fork, mirroring persistBlock's
	// delete-before-insert of the raw events at a reorged height. A flag is not
	// enough: `cursor` (block_height:stream_event_index) carries a DENSE per-block
	// ordinal recomputed by readCanonicalStreamsEvents over the surviving event
	// set, so the new fork's re-decode lands on SHIFTED cursors and inserts
	// alongside the old-fork rows instead of overwriting them (writeDecodedEvents
	// upserts on `cursor` only, never by tx). Marking the orphans canonical=false
	// also can't survive — writeDecodedEvents hard-codes canonical=true on every
	// upsert, so a later range re-derive resurrects them (the 2026-05-26 reorg left
	// 57 stale rows + a +152,062-sat sBTC over-count exactly this way; see
	// docs/internal/audits/decoded-events-reorg-reconciliation-2026-06-15.md). The
	// L2 handler owns the whole table, so an unscoped delete-by-height is correct.
	// Safe against the live decoder: this runs inside the leader-gated reorg tx and
	// the checkpoints are rewound to < blockHeight in the same tx, so the next
	// decode re-derives the new fork from a clean slate at the now-sole cursors.
	const result = await db
		.deleteFrom("decoded_events")
		.where("block_height", ">=", blockHeight)
		.executeTakeFirst();

	const checkpoints = {} as Record<L2DecoderName, string | null>;
	for (const decoderName of decoderNames) {
		const checkpoint = await readCanonicalCheckpointBeforeBlock(
			blockHeight,
			L2_DECODER_EVENT_TYPES[decoderName],
			opts?.db,
		);
		checkpoints[decoderName] = checkpoint;

		await writeDecoderCheckpoint({
			cursor: checkpoint,
			db: opts?.db,
			decoderName,
		});
	}

	return {
		deleted: Number(result.numDeletedRows ?? 0),
		checkpoints,
		checkpoint: checkpoints[FT_TRANSFER_DECODER_NAME] ?? null,
	};
}

async function readCanonicalCheckpointBeforeBlock(
	blockHeight: number,
	eventType: string,
	db?: Kysely<Database>,
): Promise<string | null> {
	const row = await l2Db(db)
		.selectFrom("decoded_events")
		.select("source_cursor")
		.where("block_height", "<", blockHeight)
		.where("event_type", "=", eventType)
		.where("canonical", "=", true)
		.orderBy("block_height", "desc")
		.orderBy("event_index", "desc")
		.limit(1)
		.executeTakeFirst();
	return row?.source_cursor ?? null;
}
