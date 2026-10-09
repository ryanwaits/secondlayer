import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { IndexHttpClient } from "@secondlayer/shared/index-http";
import { applyBlock } from "../src/runtime/apply-block.ts";
import { loadBlockRange } from "../src/runtime/batch-loader.ts";
import {
	PostgresBlockSource,
	PublicApiBlockSource,
	cachedCoverage,
	dbStateWritesCoverage,
	stateWriteContracts,
	stateWriteFeed,
} from "../src/runtime/block-source.ts";
import {
	MemoryStore,
	MemorySubgraphContext,
} from "../src/runtime/memory-store.ts";
import { loadDeterministicDefinition } from "../src/runtime/realm.ts";
import type { SubgraphDefinition } from "../src/types.ts";

/**
 * A state subgraph's write events come from `state_writes`, the rows a
 * verifier names against the block's witness, on both block sources, once
 * the instance holds them from the subgraph's startBlock on. Every other
 * subgraph, and every subgraph on an instance without them, keeps `vm_events`.
 */

const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
const OTHER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm_vault";

/** Bundled-handler shape, as esbuild emits it into `handler_code`. */
const handlerCode = (sources: Record<string, unknown>) => `
var subgraph_default = {
	name: "feed-test",
	startBlock: 880000,
	sources: ${JSON.stringify(sources)},
	schema: { reserves: { columns: { token: { type: "text" }, amount: { type: "uint", nullable: true } } } },
	handlers: { ${Object.keys(sources)
		.map(
			(k) =>
				`${k}: (event, ctx) => { ctx.insert("reserves", { token: String(event.key ?? event.varName), amount: event.value ?? null }); }`,
		)
		.join(", ")} },
};
export { subgraph_default as default };
`;

const realm = (sources: Record<string, unknown>) =>
	loadDeterministicDefinition(handlerCode(sources));

describe("which subgraphs read state_writes", () => {
	test("a realm subgraph reads its sources' contracts from state_writes", async () => {
		const def = await realm({
			reserve: { type: "map_set", contractId: POOL, map: "reserve" },
			paused: { type: "var_set", contractId: OTHER, varName: "paused" },
		});
		expect(stateWriteContracts(def)).toEqual({ contracts: [POOL, OTHER] });
	});

	test("a source with no fixed contract reads every contract's writes", async () => {
		const def = await realm({
			reserve: {
				type: "map_set",
				contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.*",
			},
		});
		expect(stateWriteContracts(def)).toEqual({ contracts: null });
	});

	test("the same definition imported outside the realm keeps vm_events", () => {
		const def = {
			name: "plain",
			sources: { reserve: { type: "map_set", contractId: POOL } },
			schema: {},
			handlers: { reserve: () => {} },
		} as unknown as SubgraphDefinition;
		expect(stateWriteContracts(def)).toBeNull();
		expect(stateWriteContracts(undefined)).toBeNull();
	});

	test("a subgraph stored as state with a map_insert source keeps vm_events: state_writes cannot tell an insert from a set", async () => {
		const def = await realm({
			reg: { type: "map_insert", contractId: POOL, map: "pools" },
			reserve: { type: "map_set", contractId: POOL, map: "reserve" },
		});
		expect(stateWriteContracts(def)).toBeNull();
	});
});

describe("the feed switches only once the instance holds state_writes for the subgraph's range", () => {
	const sources = {
		reserve: { type: "map_set", contractId: POOL, map: "reserve" },
	};

	test("no state_writes on the instance: today's feed", async () => {
		const def = await realm(sources);
		expect(await stateWriteFeed(def, async () => null)).toBeNull();
	});

	test("state_writes that begin after startBlock: today's feed, never a half-fed history", async () => {
		const def = await realm(sources);
		expect(await stateWriteFeed(def, async () => 880_001)).toBeNull();
	});

	test("state_writes from startBlock or earlier: the state_writes feed", async () => {
		const def = await realm(sources);
		expect(await stateWriteFeed(def, async () => 880_000)).toEqual({
			contracts: [POOL],
		});
		expect(await stateWriteFeed(def, async () => 9)).toEqual({
			contracts: [POOL],
		});
	});

	test("coverage is read once per window, and a failed read counts as none", async () => {
		let reads = 0;
		const coverage = cachedCoverage(async () => {
			reads++;
			return 5;
		}, 60_000);
		expect([await coverage(), await coverage()]).toEqual([5, 5]);
		expect(reads).toBe(1);
		const failing = cachedCoverage(async () => {
			throw new Error("relation state_writes does not exist");
		});
		expect(await failing()).toBeNull();
	});
});

const H = 880_101;
const HEIGHTS = [H, H + 1];
const TOKEN_KEY = "0d00000003777a6b";
const AMOUNT = "0100000000000000000000000000000064";
const utf8Hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

type Write = {
	block_height: number;
	ordinal: number;
	tx_index: number | null;
	key: string;
	value_hex: string;
};

const TXS = [
	{ tx_id: `0x${"a1".repeat(32)}`, block_height: H, tx_index: 0 },
	{ tx_id: `0x${"a2".repeat(32)}`, block_height: H, tx_index: 1 },
	{ tx_id: `0x${"a3".repeat(32)}`, block_height: H + 1, tx_index: 0 },
];

const WRITES: Write[] = [
	{
		block_height: H,
		ordinal: 0,
		tx_index: null,
		key: `vm::${POOL}::1::epoch`,
		value_hex: utf8Hex("01"),
	},
	{
		block_height: H,
		ordinal: 1,
		tx_index: 0,
		key: "vm-account::SP000000000000000000002Q6VF78::19",
		value_hex: utf8Hex("00"),
	},
	{
		block_height: H,
		ordinal: 2,
		tx_index: 1,
		key: `vm::${POOL}::0::reserve::${TOKEN_KEY}`,
		value_hex: utf8Hex(`0a${AMOUNT}`),
	},
	{
		block_height: H,
		ordinal: 3,
		tx_index: 1,
		key: `vm::${OTHER}::0::reserve::${TOKEN_KEY}`,
		value_hex: utf8Hex(`0a${AMOUNT}`),
	},
	{
		block_height: H,
		ordinal: 4,
		tx_index: 0,
		key: `vm::${POOL}::0::reserve::${TOKEN_KEY}`,
		value_hex: utf8Hex("09"),
	},
	{
		block_height: H + 1,
		ordinal: 0,
		tx_index: 0,
		key: `vm::${POOL}::1::paused`,
		value_hex: utf8Hex("03"),
	},
];

/** The Index API's state-writes and blocks routes over the seeded rows. */
function startFakeIndex() {
	return Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			const from = Number(url.searchParams.get("from_height") ?? 0);
			const to = Number(
				url.searchParams.get("to_height") ?? Number.MAX_SAFE_INTEGER,
			);
			const inRange = (h: number) => h >= from && h <= to;
			if (url.pathname === "/v1/index/blocks") {
				return Response.json({
					blocks: HEIGHTS.filter(inRange).map((h) => ({
						block_height: h,
						block_hash: `0xfeed${h}`,
						parent_hash: "0x00",
						burn_block_height: 1,
						burn_block_hash: null,
						index_block_hash: `0xfeedid${h}`,
						block_time: "2026-10-09T00:00:00.000Z",
					})),
					next_cursor: null,
				});
			}
			if (url.pathname === "/v1/index/state-writes") {
				const contract = url.searchParams.get("contract_id");
				const withTx = url.searchParams.get("tx_context") === "true";
				const rows = WRITES.filter(
					(w) =>
						inRange(w.block_height) &&
						(!contract || w.key.startsWith(`vm::${contract}::`)),
				).map((w) => {
					if (!withTx) return w;
					const tx = TXS.find(
						(t) =>
							t.block_height === w.block_height && t.tx_index === w.tx_index,
					);
					return {
						...w,
						tx_id: tx?.tx_id ?? null,
						tx_sender: tx ? "SP000000000000000000002Q6VF78" : null,
						tx_type: tx ? "contract_call" : null,
						tx_status: tx ? "success" : null,
						tx_contract_id: tx ? POOL : null,
						tx_function_name: tx ? "swap" : null,
					};
				});
				return Response.json({ state_writes: rows, next_cursor: null });
			}
			return new Response("unexpected", { status: 500 });
		},
	});
}

const pick = (txs: Array<Record<string, unknown>>) =>
	txs.map(
		({
			tx_id,
			tx_index,
			type,
			sender,
			status,
			contract_id,
			function_name,
		}) => ({
			tx_id,
			tx_index,
			type,
			sender,
			status,
			contract_id,
			function_name,
		}),
	);

describe.skipIf(!process.env.DATABASE_URL)(
	"the DB tap and the Index API feed a state subgraph the same write events",
	() => {
		const db = getSourceDb();
		const fake = startFakeIndex();

		async function cleanup() {
			await db
				.deleteFrom("state_writes")
				.where("block_height", "in", HEIGHTS)
				.execute();
			await db
				.deleteFrom("vm_events")
				.where("block_height", "in", HEIGHTS)
				.execute();
			await db
				.deleteFrom("transactions")
				.where("block_height", "in", HEIGHTS)
				.execute();
			await db.deleteFrom("blocks").where("height", "in", HEIGHTS).execute();
		}

		beforeAll(async () => {
			await cleanup();
			await db
				.insertInto("blocks")
				.values(
					HEIGHTS.map((height) => ({
						height,
						hash: `0xfeed${height}`,
						parent_hash: "0x00",
						burn_block_height: 1,
						index_block_hash: `0xfeedid${height}`,
						timestamp: 1_700_000_000,
					})),
				)
				.execute();
			await db
				.insertInto("transactions")
				.values(
					TXS.map((t) => ({
						...t,
						type: "contract_call",
						sender: "SP000000000000000000002Q6VF78",
						status: "success",
						contract_id: POOL,
						function_name: "swap",
						raw_tx: "0x00",
					})),
				)
				.execute();
			await db.insertInto("state_writes").values(WRITES).execute();
			// A vm_events row the state feed must never read.
			await db
				.insertInto("vm_events")
				.values({
					tx_id: TXS[0]?.tx_id as string,
					block_height: H,
					ordinal: 0,
					type: "map_set",
					data: {
						contract_identifier: POOL,
						map_name: "reserve",
						raw_key: `0x${TOKEN_KEY}`,
						raw_value: "0x0100000000000000000000000000000999",
					},
				})
				.execute();
		});

		afterAll(async () => {
			fake.stop(true);
			await cleanup();
		});

		const feed = { contracts: [POOL] };

		test("same vm events and txs per block, from either source", async () => {
			const tap = await new PostgresBlockSource(feed).loadBlockRange(H, H + 1);
			const api = await new PublicApiBlockSource(
				new IndexHttpClient({
					indexBaseUrl: `http://127.0.0.1:${fake.port}`,
					streamsBaseUrl: `http://127.0.0.1:${fake.port}`,
					indexApiKey: "",
				}),
				["map_set", "map_delete", "var_set"],
				undefined,
				false,
				feed,
			).loadBlockRange(H, H + 1);

			for (const h of HEIGHTS) {
				expect(api.get(h)?.vmEvents).toEqual(tap.get(h)?.vmEvents);
				expect(pick(api.get(h)?.txs ?? [])).toEqual(
					pick(tap.get(h)?.txs ?? []),
				);
			}
			// Only POOL's writes, in ordinal order, block-level write included.
			expect(
				tap.get(H)?.vmEvents?.map((e) => [e.type, e.event_index, e.tx_id]),
			).toEqual([
				["var_set", 0, ""],
				["map_set", 2, TXS[1]?.tx_id],
				["map_delete", 4, TXS[0]?.tx_id],
			]);
			expect(tap.get(H + 1)?.vmEvents?.map((e) => e.type)).toEqual(["var_set"]);
		});

		test("the Index API's coverage is its first state_writes row", async () => {
			const client = new IndexHttpClient({
				indexBaseUrl: `http://127.0.0.1:${fake.port}`,
				streamsBaseUrl: `http://127.0.0.1:${fake.port}`,
				indexApiKey: "",
			});
			expect(await client.firstStateWriteHeight()).toBe(H);
		});

		test("the DB tap's coverage is the lowest state_writes height", async () => {
			dbStateWritesCoverage.forget();
			const from = await dbStateWritesCoverage();
			expect(from).not.toBeNull();
			expect(from as number).toBeLessThanOrEqual(H);
		});

		test("handler rows: today's feed without coverage, state_writes with it", async () => {
			const def = await realm({
				reserve: { type: "map_set", contractId: POOL, map: "reserve" },
			});
			const rows = async (coverage: () => Promise<number | null>) => {
				const feed = await stateWriteFeed(def, coverage);
				const data = (
					await new PostgresBlockSource(feed ?? undefined).loadBlockRange(H, H)
				).get(H);
				const store = new MemoryStore();
				const ctx = new MemorySubgraphContext(
					store,
					def.schema,
					{ height: H, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
					{ txId: "", sender: "", type: "", status: "" },
				);
				if (data) await applyBlock(def, data, ctx);
				await ctx.commitOps();
				return (store.tables.get("reserves") ?? []).map((r) => r.amount);
			};
			// Without coverage: exactly what vm_events says, as before.
			expect(await rows(async () => null)).toEqual([0x999n]);
			// With coverage: the named writes (a set then a delete; deletes are
			// not matched by a map_set source).
			expect(await rows(async () => 880_000)).toEqual([100n]);
		});

		test("without a feed the DB tap still reads vm_events", async () => {
			const plain = await loadBlockRange(db, H, H);
			expect(plain.get(H)?.vmEvents?.map((e) => e.data)).toEqual([
				{
					contract_identifier: POOL,
					map_name: "reserve",
					raw_key: `0x${TOKEN_KEY}`,
					raw_value: "0x0100000000000000000000000000000999",
				},
			]);
			expect(plain.get(H)?.txs).toHaveLength(2);
		});
	},
);
