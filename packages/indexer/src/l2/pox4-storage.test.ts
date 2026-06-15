import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { handlePox4Reorg, writePox4Calls } from "./pox4-storage.ts";
import type { Pox4CallRow } from "./pox4-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("pox4-storage", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox4_calls`.execute(db);
		await sql`DELETE FROM l2_decoder_checkpoints WHERE decoder_name = 'l2.pox4.v1'`.execute(
			db,
		);
	});

	afterEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox4_calls`.execute(db);
		await sql`DELETE FROM l2_decoder_checkpoints WHERE decoder_name = 'l2.pox4.v1'`.execute(
			db,
		);
	});

	test("writePox4Calls upserts on cursor", async () => {
		if (!db) throw new Error("missing test db");
		await writePox4Calls(
			[fixtureRow({ cursor: "100:0", amount_ustx: "1000" })],
			{ db },
		);
		await writePox4Calls(
			[fixtureRow({ cursor: "100:0", amount_ustx: "2000" })],
			{ db },
		);
		const row = await db
			.selectFrom("pox4_calls")
			.select(["cursor", "amount_ustx"])
			.where("cursor", "=", "100:0")
			.executeTakeFirst();
		expect(row?.amount_ustx).toBe("2000");
	});

	test("handlePox4Reorg hard-deletes rows >= height, rewinds checkpoint", async () => {
		if (!db) throw new Error("missing test db");
		await writePox4Calls(
			[
				fixtureRow({ cursor: "100:0", block_height: 100, tx_index: 0 }),
				fixtureRow({ cursor: "101:0", block_height: 101, tx_index: 0 }),
				fixtureRow({ cursor: "102:0", block_height: 102, tx_index: 0 }),
			],
			{ db },
		);

		const result = await handlePox4Reorg(101, { db });

		expect(result.deleted).toBe(2);
		expect(result.checkpoint).toBe("100:0");

		const survivors = await db
			.selectFrom("pox4_calls")
			.select(["cursor", "canonical"])
			.orderBy("cursor")
			.execute();
		expect(survivors).toEqual([{ cursor: "100:0", canonical: true }]);

		// Checkpoint rewound so the decoder re-derives the new fork from < 101.
		const checkpoint = await db
			.selectFrom("l2_decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", "l2.pox4.v1")
			.executeTakeFirst();
		expect(checkpoint?.last_cursor).toBe("100:0");
	});
});

function fixtureRow(overrides: Partial<Pox4CallRow> = {}): Pox4CallRow {
	const blockHeight = overrides.block_height ?? 100;
	const txIndex = overrides.tx_index ?? 0;
	return {
		cursor: `${blockHeight}:${txIndex}`,
		block_height: blockHeight,
		block_time: new Date("2026-05-07T00:00:00.000Z"),
		burn_block_height: 900_000,
		tx_id: `0x${blockHeight.toString().padStart(8, "0")}${txIndex}`,
		tx_index: txIndex,
		function_name: "stack-stx",
		caller: "SP1CALLER",
		stacker: "SP1CALLER",
		delegate_to: null,
		amount_ustx: "100000000000",
		lock_period: 6,
		pox_addr_version: 4,
		pox_addr_hashbytes: `0x${"11".repeat(20)}`,
		pox_addr_btc: "bc1qtest",
		start_cycle: 87,
		end_cycle: 92,
		signer_key: `0x${"ab".repeat(33)}`,
		signer_signature: null,
		auth_id: "1",
		max_amount: "200000000000",
		reward_cycle: null,
		aggregated_amount_ustx: null,
		aggregated_signer_index: null,
		auth_period: null,
		auth_topic: null,
		auth_allowed: null,
		result_ok: true,
		result_raw: "0x07",
		source_cursor: `${blockHeight}:${txIndex}`,
		...overrides,
	};
}
