import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	handleDecodedEventsReorg,
	writeDecodedEvents,
} from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("L2 decoded event storage", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM l2_decoder_checkpoints`.execute(db);
	});

	test("reorg marks affected rows non-canonical and rewinds checkpoint", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row("9:0", 9, true),
				row("10:0", 10, true),
				row("11:0", 11, true),
			])
			.execute();

		const result = await handleDecodedEventsReorg(10, { db });
		const rows = await db
			.selectFrom("decoded_events")
			.select(["cursor", "canonical"])
			.orderBy("cursor")
			.execute();
		const checkpoint = await db
			.selectFrom("l2_decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", FT_TRANSFER_DECODER_NAME)
			.executeTakeFirst();
		const nftCheckpoint = await db
			.selectFrom("l2_decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", NFT_TRANSFER_DECODER_NAME)
			.executeTakeFirst();

		expect(result).toEqual({
			markedNonCanonical: 2,
			checkpoint: "9:0",
			checkpoints: {
				[FT_TRANSFER_DECODER_NAME]: "9:0",
				[NFT_TRANSFER_DECODER_NAME]: null,
			},
		});
		expect(rows).toEqual([
			{ cursor: "10:0", canonical: false },
			{ cursor: "11:0", canonical: false },
			{ cursor: "9:0", canonical: true },
		]);
		expect(checkpoint?.last_cursor).toBe("9:0");
		expect(nftCheckpoint?.last_cursor).toBeNull();
	});

	test("writeDecodedEvents reactivates canonical row after re-decode", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values(row("10:0", 10, false))
			.execute();

		await writeDecodedEvents(
			[
				{
					cursor: "10:0",
					block_height: 10,
					tx_id: "tx-new",
					tx_index: 1,
					event_index: 0,
					event_type: "ft_transfer",
					decoded_payload: {
						contract_id: "SP1.token",
						asset_identifier: "SP1.token::token",
						token_name: "token",
						sender: "SP3",
						recipient: "SP4",
						amount: "25",
					},
					source_cursor: "10:0",
				},
			],
			{ db },
		);

		const updated = await db
			.selectFrom("decoded_events")
			.select(["cursor", "canonical", "tx_id", "sender", "recipient", "amount"])
			.where("cursor", "=", "10:0")
			.executeTakeFirstOrThrow();

		expect(updated).toEqual({
			cursor: "10:0",
			canonical: true,
			tx_id: "tx-new",
			sender: "SP3",
			recipient: "SP4",
			amount: "25",
		});
	});

	test("writeDecodedEvents stores raw nft_transfer values", async () => {
		if (!db) throw new Error("missing db");

		await writeDecodedEvents(
			[
				{
					cursor: "12:0",
					block_height: 12,
					tx_id: "tx-nft",
					tx_index: 0,
					event_index: 0,
					event_type: "nft_transfer",
					decoded_payload: {
						contract_id: "SP1.collection",
						asset_identifier: "SP1.collection::token",
						token_name: "token",
						sender: "SP1",
						recipient: "SP2",
						value: "0x0100000000000000000000000000000001",
					},
					source_cursor: "12:0",
				},
			],
			{ db },
		);

		const inserted = await db
			.selectFrom("decoded_events")
			.select(["event_type", "amount", "value"])
			.where("cursor", "=", "12:0")
			.executeTakeFirstOrThrow();

		expect(inserted).toEqual({
			event_type: "nft_transfer",
			amount: null,
			value: "0x0100000000000000000000000000000001",
		});
	});
});

function row(cursor: string, blockHeight: number, canonical: boolean) {
	return {
		cursor,
		block_height: blockHeight,
		tx_id: `tx-${cursor}`,
		tx_index: 0,
		event_index: Number(cursor.split(":")[1]),
		event_type: "ft_transfer",
		microblock_hash: null,
		canonical,
		contract_id: "SP1.token",
		sender: "SP1",
		recipient: "SP2",
		amount: "10",
		asset_identifier: "SP1.token::token",
		value: null,
		memo: null,
		source_cursor: cursor,
	};
}
