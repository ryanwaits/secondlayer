import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { handlePox5Reorg, writePox5Events } from "./pox5-storage.ts";
import type { Pox5EventRow } from "./pox5-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("pox5-storage", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints WHERE decoder_name = 'decode.pox5.v1'`.execute(
			db,
		);
	});

	afterEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints WHERE decoder_name = 'decode.pox5.v1'`.execute(
			db,
		);
	});

	test("writePox5Events upserts on cursor and round-trips jsonb data", async () => {
		if (!db) throw new Error("missing test db");
		await writePox5Events(
			[fixtureRow({ cursor: "9000000:0", amount_ustx: "1000" })],
			{ db },
		);
		await writePox5Events(
			[
				fixtureRow({
					cursor: "9000000:0",
					amount_ustx: "2000",
					data: { topic: "stake", "num-cycles": "14" },
				}),
			],
			{ db },
		);
		const row = await db
			.selectFrom("pox5_events")
			.select(["cursor", "amount_ustx", "data"])
			.where("cursor", "=", "9000000:0")
			.executeTakeFirst();
		expect(row?.amount_ustx).toBe("2000");
		expect(row?.data).toEqual({ topic: "stake", "num-cycles": "14" });
	});

	test("handlePox5Reorg hard-deletes rows >= height, rewinds checkpoint", async () => {
		if (!db) throw new Error("missing test db");
		await writePox5Events(
			[
				fixtureRow({ cursor: "9000000:0", block_height: 9_000_000 }),
				fixtureRow({ cursor: "9000001:0", block_height: 9_000_001 }),
				fixtureRow({ cursor: "9000002:0", block_height: 9_000_002 }),
			],
			{ db },
		);

		const result = await handlePox5Reorg(9_000_001, { db });

		expect(result.deleted).toBe(2);
		expect(result.checkpoint).toBe("9000000:0");

		const survivors = await db
			.selectFrom("pox5_events")
			.select(["cursor", "canonical"])
			.orderBy("cursor")
			.execute();
		expect(survivors).toEqual([{ cursor: "9000000:0", canonical: true }]);

		const checkpoint = await db
			.selectFrom("decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", "decode.pox5.v1")
			.executeTakeFirst();
		expect(checkpoint?.last_cursor).toBe("9000000:0");
	});
});

function fixtureRow(overrides: Partial<Pox5EventRow> = {}): Pox5EventRow {
	const blockHeight = overrides.block_height ?? 9_000_000;
	const cursor = overrides.cursor ?? `${blockHeight}:0`;
	return {
		cursor,
		block_height: blockHeight,
		block_time: new Date("2026-07-30T09:00:00.000Z"),
		tx_id: `0x${blockHeight.toString().padStart(10, "0")}`,
		tx_index: 0,
		event_index: 0,
		topic: "stake",
		staker: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
		signer: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
		signer_manager: null,
		bond_index: null,
		amount_ustx: "5000000000",
		amount_sats: null,
		reward_cycle: null,
		first_reward_cycle: 140,
		unlock_cycle: 152,
		unlock_burn_height: 987_530,
		is_l1_lock: null,
		signer_key: null,
		data: { topic: "stake" },
		source_cursor: cursor,
		...overrides,
	};
}
