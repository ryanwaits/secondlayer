import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import {
	insertChainReorg,
	readChainReorgsForRange,
} from "@secondlayer/shared/db/queries/chain-reorgs";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import {
	type IndexStateWrite,
	type ReadStateWritesParams,
	type StateWritesReader,
	getStateWritesResponse,
	readStateWrites,
	resolveStateWritesQuery,
} from "./state-writes.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_401;
const TIP: IndexTip = {
	block_height: H + 1,
	finalized_height: H - 6,
	lag_seconds: 1,
};

function write(
	block_height: number,
	ordinal: number,
	tx_index: number | null = 0,
): IndexStateWrite {
	return {
		cursor: `${block_height}:${ordinal}`,
		block_height,
		ordinal,
		tx_index,
		key: `vm::SP.store::1::k${ordinal}`,
		value_hex: "0x0100",
	};
}

describe("state-writes query", () => {
	const q = (s: string) => new URLSearchParams(s);

	test("block_height reads exactly one block", () => {
		const resolved = resolveStateWritesQuery(q("block_height=100&limit=5"));
		expect(resolved.get("from_height")).toBe("100");
		expect(resolved.get("to_height")).toBe("100");
		expect(resolved.get("limit")).toBe("5");
		expect(resolved.has("block_height")).toBe(false);
	});

	test("block_height with a cursor at that height resumes inside the block", () => {
		const resolved = resolveStateWritesQuery(
			q("block_height=100&cursor=100:7"),
		);
		expect(resolved.get("to_height")).toBe("100");
		expect(resolved.has("from_height")).toBe(false);
		expect(resolved.get("cursor")).toBe("100:7");
	});

	test("block_height refuses a cursor at another height", () => {
		expect(() =>
			resolveStateWritesQuery(q("block_height=100&cursor=99:7")),
		).toThrow("cursor must sit at block_height");
	});

	test("block_height refuses an explicit window", () => {
		expect(() =>
			resolveStateWritesQuery(q("block_height=100&from_height=90")),
		).toThrow("mutually exclusive");
		expect(() =>
			resolveStateWritesQuery(q("block_height=100&to_height=120")),
		).toThrow("mutually exclusive");
	});

	test("block_height must be a non-negative integer", () => {
		expect(() => resolveStateWritesQuery(q("block_height=-1"))).toThrow(
			"block_height must be a non-negative integer",
		);
	});
});

describe("state-writes response", () => {
	test("reads the source tip, not the decoded tip", async () => {
		let seen: ReadStateWritesParams | undefined;
		const response = await getStateWritesResponse({
			query: new URLSearchParams("from_height=0"),
			tip: { ...TIP, block_height: 50, source_block_height: 60 },
			readStateWrites: async (params) => {
				seen = params;
				return { state_writes: [], next_cursor: null };
			},
		});
		expect(seen?.toHeight).toBe(60);
		expect(response.tip.block_height).toBe(60);
	});

	test("a resumed empty page still reports a reorg of the checkpoint height", async () => {
		const response = await getStateWritesResponse({
			query: new URLSearchParams("cursor=100:5"),
			tip: { ...TIP, block_height: 110 },
			readStateWrites: async () => ({ state_writes: [], next_cursor: null }),
			readReorgs: async (range) =>
				range.from.block_height <= 100 && range.to.block_height >= 100
					? [
							{
								id: "orphaned-writes",
								detected_at: "2026-10-07T00:00:00Z",
								fork_point_height: 100,
								old_index_block_hash: "0xold",
								new_index_block_hash: "0xnew",
								orphaned_range: { from: "100:0", to: "100:0" },
								new_canonical_tip: "100:0",
							},
						]
					: [],
		});
		expect(response.state_writes).toEqual([]);
		expect(response.reorgs.map((r) => r.id)).toEqual(["orphaned-writes"]);
	});
});

describe("GET /v1/index/state-writes", () => {
	let prevMode: string | undefined;
	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
	});
	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	function app(readStateWrites: StateWritesReader) {
		const a = new Hono();
		a.onError(errorHandler);
		a.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readStateWrites,
				readReorgs: async () => [],
			}),
		);
		return a;
	}

	const ONE_PAGE: StateWritesReader = async () => ({
		state_writes: [write(H, 0), write(H, 1, null)],
		next_cursor: `${H}:1`,
	});

	test("serves the envelope with rows, cursor, tip and reorgs", async () => {
		process.env.INSTANCE_MODE = "oss";
		const res = await app(ONE_PAGE).request(
			`/v1/index/state-writes?block_height=${H}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			state_writes: IndexStateWrite[];
			next_cursor: string;
			tip: IndexTip;
			reorgs: unknown[];
		};
		expect(body.state_writes).toEqual([write(H, 0), write(H, 1, null)]);
		expect(body.next_cursor).toBe(`${H}:1`);
		expect(body.tip.block_height).toBe(TIP.block_height);
		expect(body.reorgs).toEqual([]);
	});

	test("a finalized block is cached immutable", async () => {
		process.env.INSTANCE_MODE = "oss";
		const res = await app(ONE_PAGE).request(
			`/v1/index/state-writes?block_height=${TIP.finalized_height}`,
		);
		expect(res.headers.get("cache-control")).toContain("immutable");
		const tip = await app(ONE_PAGE).request(
			`/v1/index/state-writes?block_height=${TIP.block_height}`,
		);
		expect(tip.headers.get("cache-control")).not.toContain("immutable");
	});

	test("unknown params are refused", async () => {
		process.env.INSTANCE_MODE = "oss";
		const res = await app(ONE_PAGE).request(
			"/v1/index/state-writes?event_type=map_set",
		);
		expect(res.status).toBe(400);
	});

	test("hosted reads need an account key", async () => {
		process.env.INSTANCE_MODE = "platform";
		const res = await app(ONE_PAGE).request(
			`/v1/index/state-writes?block_height=${H}`,
		);
		expect(res.status).toBe(401);
		const keyed = await app(ONE_PAGE).request(
			`/v1/index/state-writes?block_height=${H}`,
			{ headers: { authorization: "Bearer sk-sl_index_free_test" } },
		);
		expect(keyed.status).toBe(200);
	});
});

describe.skipIf(!HAS_DB)("state_writes read", () => {
	const db = HAS_DB ? getSourceDb() : null;
	const HEIGHTS = [H, H + 1, H + 2];

	async function cleanup(): Promise<void> {
		if (!db) return;
		await db
			.deleteFrom("state_writes")
			.where("block_height", "in", HEIGHTS)
			.execute();
		await db.deleteFrom("blocks").where("height", "in", HEIGHTS).execute();
	}

	beforeEach(cleanup);
	// Leave no canonical block behind: other suites assert the DB tip.
	afterAll(cleanup);

	async function seedBlocks(canonical: Record<number, boolean> = {}) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values(
				HEIGHTS.map((height) => ({
					height,
					hash: `0xsw-${height}`,
					parent_hash: "0xparent",
					burn_block_height: 1,
					timestamp: 1_700_000_000,
					canonical: canonical[height] ?? true,
				})),
			)
			.execute();
	}

	async function seedWrites(rows: Array<[number, number, number | null]>) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("state_writes")
			.values(
				rows.map(([block_height, ordinal, tx_index]) => ({
					block_height,
					ordinal,
					tx_index,
					key: `vm::SP.store::1::k${ordinal}`,
					value_hex: "0x0100",
				})),
			)
			.execute();
	}

	const read = (p: Partial<ReadStateWritesParams> = {}) =>
		readStateWrites({
			fromHeight: H,
			toHeight: H + 2,
			limit: 100,
			db: db ?? undefined,
			...p,
		});

	test("an empty table yields an empty page", async () => {
		await seedBlocks();
		const page = await read();
		expect(page.state_writes).toEqual([]);
		expect(page.next_cursor).toBeNull();
	});

	test("rows come back in (block_height, ordinal) order, whatever the insert order", async () => {
		await seedBlocks();
		await seedWrites([
			[H + 1, 1, 2],
			[H, 2, null],
			[H + 1, 0, 0],
			[H, 0, 0],
			[H, 1, 1],
		]);
		const page = await read();
		expect(page.state_writes.map((r) => r.cursor)).toEqual([
			`${H}:0`,
			`${H}:1`,
			`${H}:2`,
			`${H + 1}:0`,
			`${H + 1}:1`,
		]);
		expect(page.state_writes[2]).toEqual({
			cursor: `${H}:2`,
			block_height: H,
			ordinal: 2,
			tx_index: null,
			key: "vm::SP.store::1::k2",
			value_hex: "0x0100",
		});
	});

	test("a cursor resumes after the last row, across heights", async () => {
		await seedBlocks();
		await seedWrites([
			[H, 0, 0],
			[H, 1, 0],
			[H + 1, 0, 0],
			[H + 2, 0, 0],
		]);
		const first = await read({ limit: 2 });
		expect(first.state_writes.map((r) => r.cursor)).toEqual([
			`${H}:0`,
			`${H}:1`,
		]);
		expect(first.next_cursor).toBe(`${H}:1`);
		const second = await read({
			limit: 2,
			after: { block_height: H, event_index: 1 },
		});
		expect(second.state_writes.map((r) => r.cursor)).toEqual([
			`${H + 1}:0`,
			`${H + 2}:0`,
		]);
		const last = await read({
			limit: 2,
			after: { block_height: H + 2, event_index: 0 },
		});
		expect(last.state_writes).toEqual([]);
		expect(last.next_cursor).toBeNull();
	});

	test("block_height through the response reads only that block", async () => {
		await seedBlocks();
		await seedWrites([
			[H, 0, 0],
			[H + 1, 0, 0],
			[H + 1, 1, 0],
			[H + 2, 0, 0],
		]);
		const response = await getStateWritesResponse({
			query: resolveStateWritesQuery(
				new URLSearchParams(`block_height=${H + 1}`),
			),
			tip: { ...TIP, block_height: H + 2 },
			readStateWrites: (p) => readStateWrites({ ...p, db: db ?? undefined }),
			readReorgs: async () => [],
		});
		expect(response.state_writes.map((r) => r.cursor)).toEqual([
			`${H + 1}:0`,
			`${H + 1}:1`,
		]);
	});

	test("writes of a non-canonical block never reach a page", async () => {
		await seedBlocks({ [H + 1]: false });
		await seedWrites([
			[H, 0, 0],
			[H + 1, 0, 0],
			[H + 2, 0, 0],
		]);
		const page = await read();
		expect(page.state_writes.map((r) => r.block_height)).toEqual([H, H + 2]);
	});

	test("a resumed page reports a reorg recorded against a lower classic ordinal", async () => {
		await seedBlocks();
		if (!db) throw new Error("missing db");
		const reorg = await insertChainReorg({
			db,
			forkPointHeight: H,
			oldIndexBlockHash: "0xsw-orphan",
			newIndexBlockHash: `0xsw-${H}`,
			orphanedFrom: { block_height: H, event_index: 0 },
			orphanedTo: { block_height: H, event_index: 0 },
			newCanonicalTip: { block_height: H, event_index: 0 },
		});
		try {
			const response = await getStateWritesResponse({
				query: new URLSearchParams(`cursor=${H}:5`),
				tip: { ...TIP, block_height: H + 2 },
				readStateWrites: (p) => readStateWrites({ ...p, db }),
				readReorgs: (range) => readChainReorgsForRange({ ...range, db }),
			});
			expect(response.state_writes).toEqual([]);
			expect(response.reorgs.map((r) => r.id)).toContain(reorg.id);
		} finally {
			await db.deleteFrom("chain_reorgs").where("id", "=", reorg.id).execute();
		}
	});
});
