import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { type PersistBlockInput, persistBlock } from "./persist.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990001;
const NETWORK = "persist-test";

function payload(hash: string, txId: string): PersistBlockInput {
	return {
		block: {
			height: H,
			hash,
			parent_hash: "0xparent",
			burn_block_height: 1,
			burn_block_hash: null,
			timestamp: 1_700_000_000,
			canonical: true,
		},
		txs: [
			{
				tx_id: txId,
				block_height: H,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				raw_tx: "0x00",
			},
		],
		evts: [
			{
				tx_id: txId,
				block_height: H,
				event_index: 0,
				type: "stx_transfer_event",
				data: { amount: "1" },
			},
		],
		blockHeight: H,
		network: NETWORK,
	};
}

describe.skipIf(!HAS_DB)("persistBlock replace-per-height", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});

	test("a reorged height holds only the latest block's txs/events", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, payload("0xblockA", "0xtxA"));
		// Reorg: a new block at the same height with a different tx set.
		await persistBlock(db, payload("0xblockB", "0xtxB"));

		const txs = await db
			.selectFrom("transactions")
			.select(["tx_id"])
			.where("block_height", "=", H)
			.execute();
		const evts = await db
			.selectFrom("events")
			.select(["tx_id"])
			.where("block_height", "=", H)
			.execute();
		const block = await db
			.selectFrom("blocks")
			.select(["hash"])
			.where("height", "=", H)
			.executeTakeFirst();

		// Replaced, not accumulated.
		expect(txs.map((t) => t.tx_id)).toEqual(["0xtxB"]);
		expect(evts.map((e) => e.tx_id)).toEqual(["0xtxB"]);
		expect(block?.hash).toBe("0xblockB");
	});
});
