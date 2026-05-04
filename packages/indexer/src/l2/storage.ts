import type { DecodedEventRow } from "@secondlayer/sdk";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Generated, Kysely } from "kysely";

export const FT_TRANSFER_DECODER_NAME = "l2.ft_transfer.v1";

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
				amount: event.decoded_payload.amount,
				asset_identifier: event.decoded_payload.asset_identifier,
				value: null,
				memo: null,
				source_cursor: event.source_cursor,
			})),
		)
		.onConflict((oc) => oc.column("cursor").doNothing())
		.execute();
}
