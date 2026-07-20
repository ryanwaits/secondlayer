import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	getEnabledDecoderNames,
	handleDecodedEventsReorg,
	writeDecodedEvents,
} from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const ALWAYS_ON = [
	"decode.ft_transfer.v1",
	"decode.nft_transfer.v1",
	"decode.stx_transfer.v1",
	"decode.stx_mint.v1",
	"decode.stx_burn.v1",
	"decode.stx_lock.v1",
	"decode.ft_mint.v1",
	"decode.ft_burn.v1",
	"decode.nft_mint.v1",
	"decode.nft_burn.v1",
	"decode.print.v1",
];

describe("getEnabledDecoderNames", () => {
	test("always-on decoders plus sbtc + pox4 + pox5 (all enabled by default)", () => {
		expect(getEnabledDecoderNames({})).toEqual([
			...ALWAYS_ON,
			"decode.sbtc.v1",
			"decode.sbtc_token.v1",
			"decode.pox4.v1",
			"decode.pox5.v1",
		]);
	});

	test("SBTC_DECODER_ENABLED=false suppresses sbtc (pox4/pox5 still default-on)", () => {
		expect(getEnabledDecoderNames({ SBTC_DECODER_ENABLED: "false" })).toEqual([
			...ALWAYS_ON,
			"decode.pox4.v1",
			"decode.pox5.v1",
		]);
	});

	test("POX4_DECODER_ENABLED=false and POX5_DECODER_ENABLED=false suppress their decoders", () => {
		expect(
			getEnabledDecoderNames({
				SBTC_DECODER_ENABLED: "false",
				POX4_DECODER_ENABLED: "false",
				POX5_DECODER_ENABLED: "false",
			}),
		).toEqual(ALWAYS_ON);
	});

	test("includes bns when its flag is 'true'", () => {
		expect(
			getEnabledDecoderNames({
				SBTC_DECODER_ENABLED: "false",
				POX4_DECODER_ENABLED: "false",
				POX5_DECODER_ENABLED: "false",
				BNS_DECODER_ENABLED: "true",
			}),
		).toEqual([...ALWAYS_ON, "decode.bns.v1"]);
	});

	test("opt-in bns ignores non-'true' values; opt-out pox4/pox5 ignore non-'false' values", () => {
		expect(
			getEnabledDecoderNames({
				SBTC_DECODER_ENABLED: "false",
				POX4_DECODER_ENABLED: "yes", // not "false" → pox4 stays on
				POX5_DECODER_ENABLED: "on", // not "false" → pox5 stays on
				BNS_DECODER_ENABLED: "TRUE", // not "true" → bns stays off
			}),
		).toEqual([...ALWAYS_ON, "decode.pox4.v1", "decode.pox5.v1"]);
	});
});

describe.skipIf(!HAS_DB)("L2 decoded event storage", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints`.execute(db);
	});

	test("reorg deletes affected rows and rewinds checkpoint", async () => {
		if (!db) throw new Error("missing db");
		// Seed an old-fork row at 11 on a cursor (11:3) the new fork will NOT
		// reproduce — a flag-only reconciliation would strand it; the delete must
		// remove every row at/above the fork regardless of cursor.
		await db
			.insertInto("decoded_events")
			.values([
				row("9:0", 9, true),
				row("10:0", 10, true),
				row("11:0", 11, true),
				row("11:3", 11, true),
			])
			.execute();

		const result = await handleDecodedEventsReorg(10, { db });
		const rows = await db
			.selectFrom("decoded_events")
			.select(["cursor", "canonical"])
			.orderBy("cursor")
			.execute();
		const checkpoint = await db
			.selectFrom("decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", FT_TRANSFER_DECODER_NAME)
			.executeTakeFirst();
		const nftCheckpoint = await db
			.selectFrom("decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", NFT_TRANSFER_DECODER_NAME)
			.executeTakeFirst();

		expect(result).toEqual({
			deleted: 3,
			checkpoint: "9:0",
			checkpoints: {
				"decode.ft_transfer.v1": "9:0",
				"decode.nft_transfer.v1": null,
				"decode.stx_transfer.v1": null,
				"decode.stx_mint.v1": null,
				"decode.stx_burn.v1": null,
				"decode.stx_lock.v1": null,
				"decode.ft_mint.v1": null,
				"decode.ft_burn.v1": null,
				"decode.nft_mint.v1": null,
				"decode.nft_burn.v1": null,
				"decode.print.v1": null,
			},
		});
		expect(rows).toEqual([{ cursor: "9:0", canonical: true }]);
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

	test("writeDecodedEvents de-dupes a batch by cursor (reorg dup-tx safety)", async () => {
		if (!db) throw new Error("missing db");
		const event = (txId: string, amount: string) => ({
			cursor: "20:0",
			block_height: 20,
			tx_id: txId,
			tx_index: 0,
			event_index: 0,
			event_type: "stx_transfer" as const,
			decoded_payload: {
				sender: "SP1",
				recipient: "SP2",
				amount,
				memo: null,
			},
			source_cursor: "20:0",
		});

		// Two events colliding on one cursor must not throw "ON CONFLICT ...
		// cannot affect row a second time"; last occurrence wins.
		await writeDecodedEvents([event("tx-a", "10"), event("tx-b", "20")], {
			db,
		});

		const rows = await db
			.selectFrom("decoded_events")
			.select(["cursor", "tx_id", "amount"])
			.where("cursor", "=", "20:0")
			.execute();
		expect(rows).toEqual([{ cursor: "20:0", tx_id: "tx-b", amount: "20" }]);
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
