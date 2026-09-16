import { afterAll, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import type { IndexHttpClient } from "@secondlayer/shared/index-http";
import type { SubgraphFilter } from "../types.ts";
import { loadBlockRange, vmEventId } from "./batch-loader.ts";
import { PublicApiBlockSource } from "./block-source.ts";
import { mapNewBlockPayloadToBlockData } from "./observer-http-source.ts";
import { type EventRecord, matchSources } from "./source-matcher.ts";

// vm_events ride a second clock (vm_event_index). These tests pin the seams
// that keep it apart from classic event_index: loader, sources, matcher.

const TX = {
	tx_id: "0xc",
	type: "contract_call",
	sender: "SP1",
	status: "success",
	tx_index: 0,
	contract_id: "SP1.wrapper",
	function_name: "buy",
};

const PRINT: EventRecord = {
	id: "0xc#0",
	tx_id: "0xc",
	type: "smart_contract_event",
	event_index: 0,
	data: {
		contract_identifier: "SP1.store",
		topic: "print",
		raw_value: "0x0d0000000568656c6c6f",
	},
};

const MAP_SET: EventRecord = {
	id: vmEventId("0xc", 0),
	tx_id: "0xc",
	type: "map_set",
	event_index: 0,
	clock: "vm",
	data: {
		contract_identifier: "SP1.store",
		map_name: "store",
		raw_key: "0x0a",
		raw_value: "0x0b",
	},
};

describe("matchSources — vm sources read the vm clock only", () => {
	test("a map_set source matches vmEvents, never events[]", () => {
		const sources: Record<string, SubgraphFilter> = {
			writes: { type: "map_set", contractId: "SP1.store", map: "store" },
		};
		// Same row shape placed on the classic list must NOT match.
		const onClassic = matchSources(sources, [TX], [MAP_SET], new Map());
		expect(onClassic).toHaveLength(0);

		const onVm = matchSources(sources, [TX], [PRINT], new Map(), new Map(), [
			MAP_SET,
		]);
		expect(onVm).toHaveLength(1);
		expect(onVm[0]?.events.map((e) => e.id)).toEqual(["0xc#vm:0"]);
	});

	test("a contract_call source hands its tx to the handler without vm rows", () => {
		const sources: Record<string, SubgraphFilter> = {
			buys: { type: "contract_call", contractId: "SP1.wrapper" },
		};
		const matched = matchSources(sources, [TX], [PRINT], new Map(), new Map(), [
			MAP_SET,
		]);
		expect(matched).toHaveLength(1);
		expect(matched[0]?.events.map((e) => e.id)).toEqual(["0xc#0"]);
	});
});

describe("PublicApiBlockSource — vm walks land in vmEvents", () => {
	const fakeHttp = {
		walkBlocks: async () => [
			{
				block_height: 1,
				block_hash: "0xb1",
				parent_hash: "0x00",
				burn_block_height: 1,
				block_time: "2026-01-01T00:00:00.000Z",
			},
		],
		walkTransactions: async () => [],
		walkEvents: async (type: string) => {
			if (type === "print") {
				return [
					{
						event_type: "print",
						block_height: 1,
						tx_id: "0xc",
						tx_index: 0,
						event_index: 0,
						contract_id: "SP1.store",
						payload: { topic: "print", raw_value: "0x0d" },
						tx_sender: "SP1",
						tx_type: "contract_call",
						tx_status: "success",
					},
				];
			}
			if (type === "map_set") {
				return [
					{
						event_type: "map_set",
						block_height: 1,
						tx_id: "0xc",
						tx_index: 0,
						event_index: 0,
						contract_id: "SP1.store",
						map: "store",
						raw_key: "0x0a",
						raw_value: "0x0b",
						tx_sender: "SP1",
						tx_type: "contract_call",
						tx_status: "success",
					},
				];
			}
			return [];
		},
		getIndexTip: async () => 1,
		getIndexSourceTip: async () => 1,
	} as unknown as IndexHttpClient;

	test("print stays in events, map_set goes to vmEvents with a vm id", async () => {
		const src = new PublicApiBlockSource(
			fakeHttp,
			["print", "map_set"],
			undefined,
			false,
		);
		const bd = (await src.loadBlockRange(1, 1)).get(1);
		expect(bd?.events.map((e) => e.id)).toEqual(["0xc#0"]);
		expect(bd?.vmEvents?.map((e) => [e.id, e.type, e.clock])).toEqual([
			["0xc#vm:0", "map_set", "vm"],
		]);
		expect((bd?.vmEvents?.[0]?.data as { map_name?: string }).map_name).toBe(
			"store",
		);
	});
});

describe("observer-http source — /new_block.vm_events", () => {
	async function fixture(name: string): Promise<unknown> {
		const url = new URL(
			`../../../indexer/test/fixtures/observer/${name}`,
			import.meta.url,
		);
		return JSON.parse(await Bun.file(url).text()) as unknown;
	}

	test("opt-in body maps node types to stored names on vmEvents", async () => {
		const bd = mapNewBlockPayloadToBlockData(
			await fixture("new_block.vm_events.json"),
		);
		expect(bd.events).toHaveLength(1);
		expect(bd.vmEvents?.map((e) => [e.event_index, e.type, e.clock])).toEqual([
			[0, "nested_contract_call", "vm"],
			[1, "map_set", "vm"],
		]);
		expect(bd.vmEvents?.[0]?.id).toMatch(/#vm:0$/);
	});

	test("`*` body yields no vmEvents", async () => {
		const bd = mapNewBlockPayloadToBlockData(
			await fixture("new_block.star.json"),
		);
		expect(bd.vmEvents).toEqual([]);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_501;

async function cleanupHeight(): Promise<void> {
	const db = getSourceDb();
	await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
	await db.deleteFrom("events").where("block_height", "=", H).execute();
	await db.deleteFrom("transactions").where("block_height", "=", H).execute();
	await db.deleteFrom("blocks").where("height", "=", H).execute();
}

describe.skipIf(!HAS_DB)(
	"Postgres tap — loadBlockRange reads vm_events",
	() => {
		// Leave no canonical block behind: other suites assert the DB tip.
		afterAll(cleanupHeight);

		test("vm rows arrive on vmEvents, not events", async () => {
			const db = getSourceDb();
			await cleanupHeight();
			await db
				.insertInto("blocks")
				.values({
					height: H,
					hash: "0xvm-tap",
					parent_hash: "0xparent",
					burn_block_height: 1,
					timestamp: 1_700_000_000,
					canonical: true,
				})
				.execute();
			await db
				.insertInto("transactions")
				.values({
					tx_id: "0xvm-tap-tx",
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
				.values({
					tx_id: "0xvm-tap-tx",
					block_height: H,
					vm_event_index: 0,
					type: "var_set",
					data: { contract_identifier: "SP.store", var_name: "n" },
				})
				.execute();

			const bd = (await loadBlockRange(db, H, H)).get(H);
			expect(bd?.events).toHaveLength(0);
			expect(bd?.vmEvents?.map((e) => [e.id, e.type, e.clock])).toEqual([
				["0xvm-tap-tx#vm:0", "var_set", "vm"],
			]);
		});
	},
);
