import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	serializeCV,
	stringAsciiCV,
	tupleCV,
} from "@secondlayer/stacks/clarity";
import { POX5_CONTRACT_ID_MAINNET } from "@secondlayer/stacks/pox5";
import { persistBlock } from "../persist.ts";
import { parseArgs, rederivePox5Events } from "./rederive-pox5-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// Below reorg.test.ts's 990050: handleReorg takes MAX(canonical height)
// >= its fork point, so leftover seeds above it would corrupt that test.
const H = 989401;
const H2 = H + 2;
const NETWORK = "rederive-pox5-test";

describe.skipIf(!HAS_DB)("rederivePox5Events", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("pox5_events")
			.where("block_height", "in", [H, H2])
			.execute();
		await db
			.deleteFrom("events")
			.where("block_height", "in", [H, H2])
			.execute();
		await db
			.deleteFrom("transactions")
			.where("block_height", "in", [H, H2])
			.execute();
		await db.deleteFrom("blocks").where("height", "in", [H, H2]).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});
	afterAll(async () => {
		if (!db) return;
		await db
			.deleteFrom("pox5_events")
			.where("block_height", "in", [H, H2])
			.execute();
		await db
			.deleteFrom("events")
			.where("block_height", "in", [H, H2])
			.execute();
		await db
			.deleteFrom("transactions")
			.where("block_height", "in", [H, H2])
			.execute();
		await db.deleteFrom("blocks").where("height", "in", [H, H2]).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});

	async function seedPox5PrintBlock(height = H): Promise<void> {
		if (!db) throw new Error("missing db");
		const tuple = tupleCV({ topic: stringAsciiCV("pause-rewards") });
		await persistBlock(db, {
			block: {
				height: height,
				hash: `0xblock${height}`,
				parent_hash: `0xparent${height}`,
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [
				{
					tx_id: `0xp5txa${height}`,
					block_height: height,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					raw_tx: "0x00",
				},
			],
			evts: [
				{
					tx_id: `0xp5txa${height}`,
					block_height: height,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: POX5_CONTRACT_ID_MAINNET,
						topic: "print",
						value: { hex: serializeCV(tuple) },
					},
				},
			],
			blockHeight: height,
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
		expect(rows).toEqual([{ tx_id: `0xp5txa${H}`, topic: "pause-rewards" }]);
	});

	test("a failure inside a chunk keeps that chunk's previous rows", async () => {
		if (!db) throw new Error("missing db");
		await seedPox5PrintBlock(H);
		await seedPox5PrintBlock(H2);
		const args = { fromHeight: H, toHeight: H2, apply: true };
		await rederivePox5Events(args);

		const select = () =>
			db
				.selectFrom("pox5_events")
				.select(["cursor", "tx_id", "topic"])
				.where("block_height", "in", [H, H2])
				.orderBy("cursor")
				.execute();
		const before = await select();
		expect(before).toHaveLength(2);

		await expect(
			rederivePox5Events(args, {
				chunkBlocks: 2,
				beforeChunkCommit: (chunk) => {
					if (chunk.fromHeight > H) throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");

		// chunk [H, H+1] committed (rewritten identically); chunk [H+2, H+3]
		// rolled back, so its old row is still there rather than deleted.
		expect(await select()).toEqual(before);
	});

	test("parseArgs rejects unknown flags and a non-positive --chunk-blocks", () => {
		const base = ["--from-height", "1", "--to-height", "2"];
		expect(() => parseArgs([...base, "--bogus"])).toThrow("unknown flag");
		expect(() => parseArgs([...base, "--chunk-blocks", "0"])).toThrow(
			"--chunk-blocks",
		);
		expect(parseArgs([...base, "--chunk-blocks", "5"]).chunkBlocks).toBe(5);
	});
});
