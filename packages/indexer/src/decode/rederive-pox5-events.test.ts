import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	serializeCV,
	stringAsciiCV,
	tupleCV,
} from "@secondlayer/stacks/clarity";
import { POX5_CONTRACT_ID_MAINNET } from "@secondlayer/stacks/pox5";
import { persistBlock } from "../persist.ts";
import { rederivePox5Events } from "./rederive-pox5-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990401;
const NETWORK = "rederive-pox5-test";

describe.skipIf(!HAS_DB)("rederivePox5Events", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("pox5_events").where("block_height", "=", H).execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});

	async function seedPox5PrintBlock(): Promise<void> {
		if (!db) throw new Error("missing db");
		const tuple = tupleCV({ topic: stringAsciiCV("pause-rewards") });
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
					tx_id: "0xp5txa",
					block_height: H,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					raw_tx: "0x00",
				},
			],
			evts: [
				{
					tx_id: "0xp5txa",
					block_height: H,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: POX5_CONTRACT_ID_MAINNET,
						topic: "print",
						value: { hex: serializeCV(tuple) },
					},
				},
			],
			blockHeight: H,
			network: NETWORK,
		});
	}

	test("dry-run decodes without writing", async () => {
		if (!db) throw new Error("missing db");
		await seedPox5PrintBlock();

		const result = await rederivePox5Events({
			fromHeight: H,
			toHeight: H,
			apply: false,
		});
		expect(result.decoded).toBe(1);

		const rows = await db
			.selectFrom("pox5_events")
			.select("topic")
			.where("block_height", "=", H)
			.execute();
		expect(rows).toHaveLength(0);
	});

	test("a window re-derive after a source repair produces the decoded row for the restored event", async () => {
		if (!db) throw new Error("missing db");
		await seedPox5PrintBlock();

		// Simulate a stale row left behind by whatever corrupted this window —
		// wrong topic, would be wiped by the delete-by-window step.
		await db
			.insertInto("pox5_events")
			.values({
				cursor: `${H}:0`,
				block_height: H,
				block_time: new Date(),
				tx_id: "0xp5stale",
				tx_index: 0,
				event_index: 0,
				topic: "stake",
				data: {},
				source_cursor: `${H}:0`,
			})
			.execute();

		const result = await rederivePox5Events({
			fromHeight: H,
			toHeight: H,
			apply: true,
		});
		expect(result.deleted).toBe(1);
		expect(result.decoded).toBe(1);

		const rows = await db
			.selectFrom("pox5_events")
			.select(["tx_id", "topic"])
			.where("block_height", "=", H)
			.execute();
		expect(rows).toEqual([{ tx_id: "0xp5txa", topic: "pause-rewards" }]);
	});
});
