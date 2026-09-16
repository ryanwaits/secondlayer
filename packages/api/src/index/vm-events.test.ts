import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import {
	insertChainReorg,
	readChainReorgsForRange,
} from "@secondlayer/shared/db/queries/chain-reorgs";
import {
	getIndexEventsResponse,
	parseIndexEventsQuery,
	readIndexEvents,
} from "./events.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_301;
const TIP: IndexTip = {
	block_height: H,
	finalized_height: H - 6,
	lag_seconds: 1,
};

describe("Index VM resume reorgs", () => {
	for (const scenario of ["empty", "later match", "tip rewound"] as const) {
		test(`reports the checkpoint's orphaned height with ${scenario}`, async () => {
			const response = await getIndexEventsResponse({
				query: new URLSearchParams("event_type=map_set&cursor=100:5"),
				tip: {
					block_height: 90,
					source_block_height: scenario === "tip rewound" ? 99 : 110,
					finalized_height: 80,
					lag_seconds: 0,
				},
				readEvents: async () => {
					if (scenario === "tip rewound") {
						throw new Error("must not read past the source tip");
					}
					return {
						events:
							scenario === "later match"
								? [
										{
											cursor: "110:0",
											block_height: 110,
											block_time: null,
											tx_id: "0xnew",
											tx_index: 0,
											event_index: 0,
											event_type: "map_set",
											contract_id: "SP.store",
											map: "balances",
										},
									]
								: [],
						next_cursor: scenario === "later match" ? "110:0" : null,
					};
				},
				readReorgs: async (range) =>
					range.from.block_height <= 100 && range.to.block_height >= 100
						? [
								{
									id: "orphaned-map",
									detected_at: "2026-09-15T00:00:00Z",
									fork_point_height: 100,
									old_index_block_hash: "0xold",
									new_index_block_hash: "0xnew",
									orphaned_range: { from: "100:0", to: "100:0" },
									new_canonical_tip: "100:0",
								},
							]
						: [],
			});
			expect(response.reorgs.map((r) => r.id)).toEqual(["orphaned-map"]);
		});
	}
});

describe("Index vm_events query parse", () => {
	function params(query: string) {
		return new URL(`http://localhost/v1/index/events${query}`).searchParams;
	}

	test("nested_contract_call is an Index event_type", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=nested_contract_call"),
			TIP,
		);
		expect(parsed.eventType).toBe("nested_contract_call");
	});

	test("contract_call is still not an Index event_type", () => {
		expect(() =>
			parseIndexEventsQuery(params("?event_type=contract_call"), TIP),
		).toThrow("unknown event_type");
	});

	test("every allowed vm filter lands in filters (none silently ignored)", () => {
		const parsed = parseIndexEventsQuery(
			params(
				"?event_type=nested_contract_call&sender=SP1&caller=SP.wrapper&function_name=transfer&tx_id=0xab",
			),
			TIP,
		);
		expect(parsed.filters.sender).toBe("SP1");
		expect(parsed.filters.caller).toBe("SP.wrapper");
		expect(parsed.filters.function_name).toBe("transfer");
		expect(parsed.filters.tx_id).toBe("0xab");
	});

	test("tx_id is rejected for classic event types", () => {
		expect(() =>
			parseIndexEventsQuery(params("?event_type=ft_transfer&tx_id=0xab"), TIP),
		).toThrow(/unknown query param: tx_id/);
	});

	test("map filter is accepted for map_set", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=map_set&map=store"),
			TIP,
		);
		expect(parsed.filters.map).toBe("store");
	});
});

describe.skipIf(!HAS_DB)("Index vm_events read", () => {
	const db = HAS_DB ? getSourceDb() : null;
	const txId = "0xvm-index-tx";

	async function cleanup(): Promise<void> {
		if (!db) return;
		await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
	}

	beforeEach(cleanup);
	// Leave no canonical block behind: other suites assert the DB tip.
	afterAll(cleanup);

	async function seed() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xvm-index",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: txId,
				block_height: H,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			})
			.execute();
		await db
			.insertInto("vm_events")
			.values([
				{
					tx_id: txId,
					block_height: H,
					vm_event_index: 0,
					type: "nested_contract_call",
					data: {
						contract_identifier: "SP.store",
						sender: "SP1",
						caller: "SP.caller",
						function_name: "set-value",
						function_args: ["0x0d"],
						raw_result: "0x0703",
					},
				},
				{
					tx_id: txId,
					block_height: H,
					vm_event_index: 1,
					type: "map_set",
					data: {
						contract_identifier: "SP.store",
						map_name: "store",
						raw_key: "0x0a",
						raw_value: "0x0b",
					},
				},
			])
			.execute();
	}

	test("reads remapped nested call + map_set on vm_event_index cursor", async () => {
		await seed();
		const nested = await readIndexEvents({
			eventType: "nested_contract_call",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db: db ?? undefined,
		});
		expect(nested.events).toHaveLength(1);
		expect(nested.events[0]?.event_type).toBe("nested_contract_call");
		expect(nested.events[0]?.event_index).toBe(0);
		expect(nested.events[0]?.cursor).toBe(`${H}:0`);
		expect(nested.events[0]?.function_name).toBe("set-value");

		const maps = await readIndexEvents({
			eventType: "map_set",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db: db ?? undefined,
		});
		expect(maps.events).toHaveLength(1);
		expect(maps.events[0]?.event_index).toBe(1);
		expect(maps.events[0]?.map).toBe("store");
	});

	test("a row without contract_identifier never reaches a page (requiredNonNull parity)", async () => {
		await seed();
		if (!db) throw new Error("missing db");
		await db
			.insertInto("vm_events")
			.values({
				tx_id: txId,
				block_height: H,
				vm_event_index: 2,
				type: "map_set",
				// Envelope-shaped garbage: no contract_identifier / map_name.
				data: { txid: txId, committed: true, type: "map_set_event" },
			})
			.execute();
		const maps = await readIndexEvents({
			eventType: "map_set",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db,
		});
		expect(maps.events.map((e) => e.event_index)).toEqual([1]);
	});

	test("empty vm_events table yields empty Index pages", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xvm-empty",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		const nested = await readIndexEvents({
			eventType: "nested_contract_call",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db,
		});
		expect(nested.events).toHaveLength(0);
		expect(nested.next_cursor).toBeNull();
	});

	test("an empty resumed SQL page reports a reorg with a lower classic ordinal", async () => {
		await seed();
		if (!db) throw new Error("missing db");
		const reorg = await insertChainReorg({
			db,
			forkPointHeight: H,
			oldIndexBlockHash: "0xvm-orphan",
			newIndexBlockHash: "0xvm-index",
			orphanedFrom: { block_height: H, event_index: 0 },
			orphanedTo: { block_height: H, event_index: 0 },
			newCanonicalTip: { block_height: H, event_index: 0 },
		});
		try {
			const response = await getIndexEventsResponse({
				query: new URLSearchParams(`event_type=map_set&cursor=${H}:5`),
				tip: TIP,
				readEvents: (p) => readIndexEvents({ ...p, db }),
				readReorgs: (range) => readChainReorgsForRange({ ...range, db }),
			});
			expect(response.events).toEqual([]);
			expect(response.reorgs.map((r) => r.id)).toContain(reorg.id);
		} finally {
			await db.deleteFrom("chain_reorgs").where("id", "=", reorg.id).execute();
		}
	});
});
