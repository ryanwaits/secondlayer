import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { persistBlock } from "./persist.ts";
import { rederiveDecodedEvents } from "./rederive-decoded-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_801;
const NETWORK = "rederive-decoded-events-test";

describe.skipIf(!HAS_DB)("rederiveDecodedEvents", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("decoded_events")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});

	async function seedStxTransferBlock(): Promise<void> {
		if (!db) throw new Error("missing db");
		await persistBlock(db, {
			block: {
				height: H,
				hash: "0xblockH",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [
				{
					tx_id: "0xrederivedecodedtx",
					block_height: H,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1ABC",
					status: "success",
					raw_tx: "0x00",
				},
			],
			evts: [
				{
					tx_id: "0xrederivedecodedtx",
					block_height: H,
					event_index: 0,
					type: "stx_transfer_event",
					data: { sender: "SP1ABC", recipient: "SP2DEF", amount: "500" },
				},
			],
			blockHeight: H,
			network: NETWORK,
		});
	}

	test("a window re-derive after a source repair produces the decoded row for the restored event", async () => {
		if (!db) throw new Error("missing db");
		await seedStxTransferBlock();

		// A stale row from before the source repair — the window delete step
		// must clear it, not leave it alongside the freshly decoded one.
		await db
			.insertInto("decoded_events")
			.values({
				cursor: `${H}:0`,
				block_height: H,
				tx_id: "0xstale-decoded",
				tx_index: 0,
				event_index: 0,
				event_type: "stx_transfer",
				source_cursor: `${H}:0`,
			})
			.execute();

		const result = await rederiveDecodedEvents({
			fromHeight: H,
			toHeight: H,
			apply: true,
			types: ["stx_transfer"],
		});
		expect(result.deleted).toBe(1);
		expect(result.decoded).toBe(1);

		const rows = await db
			.selectFrom("decoded_events")
			.select(["tx_id", "event_type"])
			.where("block_height", "=", H)
			.execute();
		expect(rows).toEqual([
			{ tx_id: "0xrederivedecodedtx", event_type: "stx_transfer" },
		]);
	});

	test("dry-run decodes without writing or deleting", async () => {
		if (!db) throw new Error("missing db");
		await seedStxTransferBlock();

		const result = await rederiveDecodedEvents({
			fromHeight: H,
			toHeight: H,
			apply: false,
			types: ["stx_transfer"],
		});
		expect(result.decoded).toBe(1);
		expect(result.deleted).toBe(0);

		const rows = await db
			.selectFrom("decoded_events")
			.select("tx_id")
			.where("block_height", "=", H)
			.execute();
		expect(rows).toHaveLength(0);
	});
});
