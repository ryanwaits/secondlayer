import type { DecodedEventRow } from "@secondlayer/sdk";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Generated, Kysely } from "kysely";

export const FT_TRANSFER_DECODER_NAME = "l2.ft_transfer.v1";
export const NFT_TRANSFER_DECODER_NAME = "l2.nft_transfer.v1";

export const L2_DECODER_NAMES = [
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
] as const;

export type L2DecoderName = (typeof L2_DECODER_NAMES)[number];

export const L2_DECODER_EVENT_TYPES: Record<L2DecoderName, string> = {
	[FT_TRANSFER_DECODER_NAME]: "ft_transfer",
	[NFT_TRANSFER_DECODER_NAME]: "nft_transfer",
};

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

export async function writeDecodedEvents(
	events: readonly DecodedEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (events.length === 0) return;

	const db = l2Db(opts?.db);
	await db
		.insertInto("decoded_events")
		.values(
			events.map((event) => ({
				cursor: event.cursor,
				block_height: event.block_height,
				tx_id: event.tx_id,
				tx_index: event.tx_index,
				event_index: event.event_index,
				event_type: event.event_type,
				contract_id: event.decoded_payload.contract_id,
				sender: event.decoded_payload.sender,
				recipient: event.decoded_payload.recipient,
				amount:
					event.event_type === "ft_transfer"
						? event.decoded_payload.amount
						: null,
				asset_identifier: event.decoded_payload.asset_identifier,
				value:
					event.event_type === "nft_transfer"
						? event.decoded_payload.value
						: null,
				memo: null,
				source_cursor: event.source_cursor,
			})),
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
