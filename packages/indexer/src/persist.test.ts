import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { listen } from "@secondlayer/shared/queue/listener";
import { type PersistBlockInput, persistBlock } from "./persist.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990001;
const NETWORK = "persist-test";

function payload(
	hash: string,
	txId: string,
	height: number = H,
): PersistBlockInput {
	return {
		block: {
			height,
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
				block_height: height,
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
				block_height: height,
				event_index: 0,
				type: "stx_transfer_event",
				data: { amount: "1" },
			},
		],
		blockHeight: height,
		network: NETWORK,
	};
}

describe.skipIf(!HAS_DB)("persistBlock replace-per-height", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("vm_events")
			.where("block_height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("events")
			.where("block_height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("transactions")
			.where("block_height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("blocks")
			.where("height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
		await db
			.deleteFrom("events_archive")
			.where("block_height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("transactions_archive")
			.where("block_height", "in", [H, H + 1])
			.execute();
		await db
			.deleteFrom("vm_events_archive")
			.where("block_height", "in", [H, H + 1])
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

	test("reorg archives the orphaned rows instead of destroying them", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, payload("0xblockA", "0xtxA"));
		await persistBlock(db, payload("0xblockB", "0xtxB"));

		const archivedTxs = await db
			.selectFrom("transactions_archive")
			.select(["tx_id", "orphaned_block_hash"])
			.where("block_height", "=", H)
			.execute();
		const archivedEvts = await db
			.selectFrom("events_archive")
			.select(["tx_id", "orphaned_block_hash"])
			.where("block_height", "=", H)
			.execute();

		// The orphaned A rows are preserved, tagged with the displaced block hash.
		expect(archivedTxs.map((t) => t.tx_id)).toEqual(["0xtxA"]);
		expect(archivedTxs[0]?.orphaned_block_hash).toBe("0xblockA");
		expect(archivedEvts.map((e) => e.tx_id)).toEqual(["0xtxA"]);
		expect(archivedEvts[0]?.orphaned_block_hash).toBe("0xblockA");
	});

	test("redelivery of the same block does not archive", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, payload("0xblockA", "0xtxA"));
		// Same hash → not a reorg, nothing orphaned.
		await persistBlock(db, payload("0xblockA", "0xtxA"));

		const archivedTxs = await db
			.selectFrom("transactions_archive")
			.select(["tx_id"])
			.where("block_height", "=", H)
			.execute();
		expect(archivedTxs).toHaveLength(0);
	});

	test("a re-mined tx is owned by the incoming block; replace-H leaves H+1 intact", async () => {
		if (!db) throw new Error("missing db");

		const first = payload("0xblockA", "0xtxT", H);
		first.vmEvts = [
			{
				tx_id: "0xtxT",
				block_height: H,
				ordinal: 0,
				type: "map_set",
				data: { map_name: "orig" },
			},
		];
		await persistBlock(db, first);

		const remine = payload("0xblockC", "0xtxT", H + 1);
		const remineTx = remine.txs[0];
		if (!remineTx) throw new Error("payload tx");
		remine.txs = [{ ...remineTx, tx_index: 3 }];
		remine.vmEvts = [
			{
				tx_id: "0xtxT",
				block_height: H + 1,
				ordinal: 1,
				type: "map_set",
				data: { map_name: "remine" },
			},
		];
		await persistBlock(db, remine);

		const txT = await db
			.selectFrom("transactions")
			.select(["tx_id", "block_height", "tx_index"])
			.where("tx_id", "=", "0xtxT")
			.executeTakeFirst();
		expect(Number(txT?.block_height)).toBe(H + 1);
		expect(Number(txT?.tx_index)).toBe(3);

		// Old ownership is archived before the move — not after H is replaced,
		// when the live row is already gone.
		const archivedAtMove = await db
			.selectFrom("transactions_archive")
			.select([
				"tx_id",
				"block_height",
				"tx_index",
				"type",
				"sender",
				"status",
				"function_name",
				"orphaned_block_hash",
			])
			.where("tx_id", "=", "0xtxT")
			.execute();
		expect(archivedAtMove).toHaveLength(1);
		expect(archivedAtMove[0]?.tx_id).toBe("0xtxT");
		expect(Number(archivedAtMove[0]?.block_height)).toBe(H);
		expect(Number(archivedAtMove[0]?.tx_index)).toBe(0);
		expect(archivedAtMove[0]?.type).toBe("contract_call");
		expect(archivedAtMove[0]?.sender).toBe("SP1");
		expect(archivedAtMove[0]?.status).toBe("success");
		expect(archivedAtMove[0]?.function_name).toBe("f");
		expect(archivedAtMove[0]?.orphaned_block_hash).toBe("0xblockA");

		await persistBlock(db, payload("0xblockB", "0xtxOther", H));

		const moved = await db
			.selectFrom("transactions")
			.select(["block_height", "tx_index"])
			.where("tx_id", "=", "0xtxT")
			.executeTakeFirst();
		expect(Number(moved?.block_height)).toBe(H + 1);
		expect(Number(moved?.tx_index)).toBe(3);

		const evtsAtHPlus1 = await db
			.selectFrom("events")
			.select(["tx_id"])
			.where("tx_id", "=", "0xtxT")
			.where("block_height", "=", H + 1)
			.execute();
		expect(evtsAtHPlus1).toHaveLength(1);

		const vmAtHPlus1 = await db
			.selectFrom("vm_events")
			.select(["ordinal", "data"])
			.where("tx_id", "=", "0xtxT")
			.where("block_height", "=", H + 1)
			.execute();
		expect(vmAtHPlus1).toHaveLength(1);
		expect(Number(vmAtHPlus1[0]?.ordinal)).toBe(1);
		expect((vmAtHPlus1[0]?.data as { map_name: string }).map_name).toBe(
			"remine",
		);

		const archivedHPlus1 = await db
			.selectFrom("vm_events_archive")
			.select("tx_id")
			.where("block_height", "=", H + 1)
			.execute();
		expect(archivedHPlus1).toHaveLength(0);

		const archivedVmAtH = await db
			.selectFrom("vm_events_archive")
			.select(["tx_id", "orphaned_block_hash"])
			.where("block_height", "=", H)
			.where("tx_id", "=", "0xtxT")
			.execute();
		expect(archivedVmAtH).toEqual([
			{ tx_id: "0xtxT", orphaned_block_hash: "0xblockA" },
		]);
		const archivedTxAtH = await db
			.selectFrom("transactions_archive")
			.select("tx_id")
			.where("tx_id", "=", "0xtxT")
			.where("block_height", "=", H)
			.execute();
		expect(archivedTxAtH).toHaveLength(1);
	});

	test("leftover events at another height for a tx still at H do not halt ingest", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, payload("0xblockA", "0xtxT", H));
		await db
			.insertInto("blocks")
			.values({
				height: H + 1,
				hash: "0xstray",
				parent_hash: "0xblockA",
				burn_block_height: 1,
				timestamp: 1_700_000_001,
				canonical: true,
			})
			.execute();
		// Desync the old way: events at H+1, tx row still at H.
		await db
			.insertInto("events")
			.values({
				tx_id: "0xtxT",
				block_height: H + 1,
				event_index: 0,
				type: "stx_transfer_event",
				data: { amount: "1" },
			})
			.execute();

		await persistBlock(db, payload("0xblockB", "0xtxOther", H));

		expect(
			await db
				.selectFrom("transactions")
				.select("tx_id")
				.where("tx_id", "=", "0xtxT")
				.execute(),
		).toHaveLength(0);
	});

	test("absent vm_events leaves the second clock empty and classic events intact", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, payload("0xblockA", "0xtxA"));

		const classic = await db
			.selectFrom("events")
			.select(["event_index", "type"])
			.where("block_height", "=", H)
			.execute();
		const vm = await db
			.selectFrom("vm_events")
			.selectAll()
			.where("block_height", "=", H)
			.execute();

		expect(classic).toEqual([{ event_index: 0, type: "stx_transfer_event" }]);
		expect(vm).toHaveLength(0);
	});

	test("present vm_events persist remapped types on ordinal", async () => {
		if (!db) throw new Error("missing db");
		const input = payload("0xblockA", "0xtxA");
		input.vmEvts = [
			{
				tx_id: "0xtxA",
				block_height: H,
				ordinal: 0,
				type: "nested_contract_call",
				data: { function_name: "set-value" },
			},
			{
				tx_id: "0xtxA",
				block_height: H,
				ordinal: 1,
				type: "map_set",
				data: { map_name: "store" },
			},
		];
		await persistBlock(db, input);

		const classic = await db
			.selectFrom("events")
			.select(["event_index", "type"])
			.where("block_height", "=", H)
			.execute();
		const vm = await db
			.selectFrom("vm_events")
			.select(["ordinal", "type"])
			.where("block_height", "=", H)
			.orderBy("ordinal", "asc")
			.execute();
		const mixed = await db
			.selectFrom("events")
			.select(["type"])
			.where("block_height", "=", H)
			.where("type", "in", ["nested_contract_call", "map_set"])
			.execute();

		expect(classic).toEqual([{ event_index: 0, type: "stx_transfer_event" }]);
		expect(vm).toEqual([
			{ ordinal: 0, type: "nested_contract_call" },
			{ ordinal: 1, type: "map_set" },
		]);
		expect(mixed).toHaveLength(0);
	});

	test("reorg archives vm_events instead of destroying them", async () => {
		if (!db) throw new Error("missing db");
		const first = payload("0xblockA", "0xtxA");
		first.vmEvts = [
			{
				tx_id: "0xtxA",
				block_height: H,
				ordinal: 0,
				type: "map_set",
				data: { map_name: "store" },
			},
		];
		await persistBlock(db, first);
		await persistBlock(db, payload("0xblockB", "0xtxB"));

		const live = await db
			.selectFrom("vm_events")
			.select(["tx_id"])
			.where("block_height", "=", H)
			.execute();
		const archived = await db
			.selectFrom("vm_events_archive")
			.select(["tx_id", "orphaned_block_hash", "ordinal"])
			.where("block_height", "=", H)
			.execute();

		expect(live).toHaveLength(0);
		expect(archived).toEqual([
			{ tx_id: "0xtxA", orphaned_block_hash: "0xblockA", ordinal: 0 },
		]);
	});

	test("notifies indexer:new_block with the committed height only after commit", async () => {
		if (!db) throw new Error("missing db");
		const received: string[] = [];
		const stop = await listen("indexer:new_block", (payload) => {
			if (payload) received.push(payload);
		});
		try {
			await persistBlock(db, payload("0xblockNotify", "0xtxNotify"));
			// LISTEN/NOTIFY delivery isn't synchronous with commit — give the
			// notification a moment to arrive on this connection.
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(received).toContain(String(H));
		} finally {
			await stop();
		}
	});
});
