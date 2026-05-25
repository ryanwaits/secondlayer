import type { DecodedEventColumns, DecodedEventRow } from "@secondlayer/sdk";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Generated, Kysely } from "kysely";

export const FT_TRANSFER_DECODER_NAME = "l2.ft_transfer.v1";
export const NFT_TRANSFER_DECODER_NAME = "l2.nft_transfer.v1";
export const STX_TRANSFER_DECODER_NAME = "l2.stx_transfer.v1";
export const STX_MINT_DECODER_NAME = "l2.stx_mint.v1";
export const STX_BURN_DECODER_NAME = "l2.stx_burn.v1";
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
		FT_MINT_DECODER_NAME,
		FT_BURN_DECODER_NAME,
		NFT_MINT_DECODER_NAME,
		NFT_BURN_DECODER_NAME,
		PRINT_DECODER_NAME,
	];
	// String literals here (not imports) to keep storage.ts free of cycles
	// with sbtc-/pox4-/bns-storage.ts; the canonical defs live in those files.
	// sbtc defaults to enabled (see service.ts) — only suppressed via
	// explicit `SBTC_DECODER_ENABLED=false`. Mirrors that policy here so
	// /public/status surfaces the same decoder set the indexer actually
	// runs.
	if (env.SBTC_DECODER_ENABLED !== "false") {
		names.push("l2.sbtc.v1", "l2.sbtc_token.v1");
	}
	if (env.POX4_DECODER_ENABLED === "true") names.push("l2.pox4.v1");
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
	return (db ?? getTargetDb()) as unknown as Kysely<L2Database>;
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

	const db = l2Db(opts?.db);
	await db
		.insertInto("decoded_events")
		.values(
			events.map((event) => {
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
	markedNonCanonical: number;
	checkpoints: Record<L2DecoderName, string | null>;
	checkpoint: string | null;
}> {
	const db = l2Db(opts?.db);
	const decoderNames = opts?.decoderNames ?? L2_DECODER_NAMES;

	const result = await db
		.updateTable("decoded_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
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
		markedNonCanonical: Number(result.numUpdatedRows ?? 0),
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
