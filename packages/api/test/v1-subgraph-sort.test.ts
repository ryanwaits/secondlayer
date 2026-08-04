import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { sql } from "kysely";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter, {
	startSubgraphCache,
	stopSubgraphCache,
} from "../src/routes/subgraphs.ts";
import v1SubgraphsRouter from "../src/routes/v1-subgraphs.ts";

// biome-ignore lint/suspicious/noExplicitAny: test JSON response typing
type Json = any;

const SKIP = !process.env.DATABASE_URL;

// ── Fixture: 14 rows engineered so a DESC sort on `amount` ties four rows at
// 90 across a page boundary (limit=5), and `delegate_to` mixes NULLs with
// distinct non-null values for the NULL-partition tests. One row's `amount`
// exceeds Number.MAX_SAFE_INTEGER to prove the cursor round-trips it as a
// string, never a JS number.
const SUBGRAPH_NAME = "test-v1-sort-subgraph";
const PG_SCHEMA = "subgraph_test_v1_sort_subgraph";
const BIG_AMOUNT = "30605870722609774469373";

const subgraphDef = {
	name: SUBGRAPH_NAME,
	version: "1.0.0",
	definition: {
		name: SUBGRAPH_NAME,
		sources: [{ contract: "SP123::sort-fixture" }],
		schema: {
			holders: {
				columns: {
					holder: { type: "text" },
					amount: { type: "uint" },
					delegate_to: { type: "text", nullable: true },
					meta: { type: "jsonb" },
				},
			},
		},
	},
	schemaHash: "test-hash-v1-sort",
	handlerPath: resolve(__dirname, "../../../fixtures/test-handler.ts"),
};

describe.skipIf(SKIP)("/v1 sorted keyset pagination (_sort/_order)", () => {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/subgraphs", subgraphsRouter);
	app.route("/v1/subgraphs", v1SubgraphsRouter);

	beforeAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);

		await registerSubgraph(db, subgraphDef);
		await db
			.updateTable("subgraphs")
			.set({ visibility: "public" })
			.where("name", "=", SUBGRAPH_NAME)
			.execute();

		const client = getRawClient();
		await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
		await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${PG_SCHEMA}.holders (
        "_id" SERIAL PRIMARY KEY,
        "_block_height" BIGINT NOT NULL,
        "_tx_id" TEXT NOT NULL,
        "_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "holder" TEXT NOT NULL,
        "amount" NUMERIC NOT NULL,
        "delegate_to" TEXT,
        "meta" JSONB
      )
    `);
		// _id 1..14 in insertion order. amount ties: 100 x3 (id 1-3), 90 x4
		// (id 4-7) — the 90 tie straddles the limit=5 page boundary. delegate_to:
		// NULL on ids 2,4,6,9,11,13 (6 rows), distinct non-null on the rest.
		await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.holders
        ("_block_height", "_tx_id", "holder", "amount", "delegate_to", "meta")
      VALUES
        (100, 'tx1',  'holder_1',  '100', 'SP_X',   '{}'),
        (100, 'tx2',  'holder_2',  '100', NULL,     '{}'),
        (100, 'tx3',  'holder_3',  '100', 'SP_Y',   '{}'),
        (101, 'tx4',  'holder_4',  '90',  NULL,     '{}'),
        (101, 'tx5',  'holder_5',  '90',  'SP_Z',   '{}'),
        (101, 'tx6',  'holder_6',  '90',  NULL,     '{}'),
        (101, 'tx7',  'holder_7',  '90',  'SP_W',   '{}'),
        (102, 'tx8',  'holder_8',  '80',  'SP_A',   '{}'),
        (102, 'tx9',  'holder_9',  '70',  NULL,     '{}'),
        (102, 'tx10', 'holder_10', '60',  'SP_B',   '{}'),
        (103, 'tx11', 'holder_11', '50',  NULL,     '{}'),
        (103, 'tx12', 'holder_12', '40',  'SP_C',   '{}'),
        (103, 'tx13', 'holder_13', '30',  NULL,     '{}'),
        (103, 'tx14', 'holder_14', '${BIG_AMOUNT}', 'SP_BIG', '{}')
    `);

		await startSubgraphCache();
	});

	afterAll(async () => {
		await stopSubgraphCache();
		const db = getDb();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
	});

	/** Ground truth: the same ordering, run as a single unpaginated query
	 *  against the raw table. Test 2/6/3/6b compare the paginated walk
	 *  against this directly, per the plan's own definition of correctness. */
	async function unpaginatedIds(orderBySql: string): Promise<string[]> {
		const rows = (await getRawClient().unsafe(
			`SELECT "_id" FROM ${PG_SCHEMA}.holders ORDER BY ${orderBySql}`,
		)) as { _id: number }[];
		return rows.map((r) => String(r._id));
	}

	/** Walks /v1 cursor pagination to exhaustion (bounded to 20 pages — well
	 *  above the 14-row fixture's worst case) and returns the concatenated
	 *  `_id` sequence plus how many pages it took. */
	async function walk(queryString: string): Promise<{
		ids: string[];
		pages: number;
	}> {
		let cursor: string | null = null;
		const ids: string[] = [];
		let pages = 0;
		for (let i = 0; i < 20; i++) {
			const cursorQs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
			const res = await app.request(
				`/v1/subgraphs/${SUBGRAPH_NAME}/holders?${queryString}${cursorQs}`,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			pages++;
			for (const row of body.rows) ids.push(String(row._id));
			cursor = body.next_cursor;
			if (!cursor) break;
		}
		return { ids, pages };
	}

	// ── Test 1 ────────────────────────────────────────────────────────────

	test("_sort=amount&_order=desc: descending amount, ties broken by _id descending", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_limit=14`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		const expected = await unpaginatedIds('amount DESC, "_id" DESC');
		expect(body.rows.map((r: Json) => String(r._id))).toEqual(expected);
	});

	// ── Test 2 — the test the whole plan exists to satisfy ─────────────────

	test("full pagination walk (desc, duplicate sort values spanning a page boundary) matches unpaginated ORDER BY exactly", async () => {
		const expected = await unpaginatedIds('amount DESC, "_id" DESC');
		const { ids, pages } = await walk("_sort=amount&_order=desc&_limit=5");
		expect(pages).toBeGreaterThanOrEqual(3);
		expect(ids).toEqual(expected);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// ── Test 3 ────────────────────────────────────────────────────────────

	test("full pagination walk (asc) matches unpaginated ORDER BY exactly", async () => {
		const expected = await unpaginatedIds('amount ASC, "_id" ASC');
		const { ids } = await walk("_sort=amount&_order=asc&_limit=5");
		expect(ids).toEqual(expected);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// ── Test 4 — regression guard: unsorted /v1 is untouched ────────────────

	test("no _sort: cursor is still a bare _id integer, byte-identical to today", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_limit=5`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.rows.length).toBe(5);
		expect(body.next_cursor).toMatch(/^\d+$/);
		expect(body.next_cursor).toBe(String(body.rows[body.rows.length - 1]._id));

		const expected = await unpaginatedIds('"_id" ASC');
		const { ids } = await walk("_limit=5");
		expect(ids).toEqual(expected);
	});

	// ── Test 5 ────────────────────────────────────────────────────────────

	test("a cursor issued under _sort=amount replayed under _sort=holder → 400", async () => {
		const first = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_limit=5`,
		);
		const body = (await first.json()) as Json;
		expect(body.next_cursor).not.toBeNull();

		const replay = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=holder&_order=desc&_limit=5&cursor=${encodeURIComponent(body.next_cursor)}`,
		);
		expect(replay.status).toBe(400);
		const err = (await replay.json()) as Json;
		expect(err.code).toBe("VALIDATION_ERROR");
		expect(err.error).toMatch(/_sort=amount/);
		expect(err.error).toMatch(/_sort=holder/);
	});

	// ── Test 6 — NULL partition ──────────────────────────────────────────

	test("NULL partition (desc): full walk over a nullable sort column visits every row exactly once", async () => {
		const expected = await unpaginatedIds(
			'delegate_to DESC NULLS FIRST, "_id" DESC',
		);
		const { ids, pages } = await walk("_sort=delegate_to&_order=desc&_limit=4");
		expect(pages).toBeGreaterThanOrEqual(3);
		expect(ids).toEqual(expected);
		expect(new Set(ids).size).toBe(14);
		// NULLS FIRST for DESC: the first page is entirely the 6 NULL rows.
		const firstPage = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=delegate_to&_order=desc&_limit=4`,
		);
		const firstBody = (await firstPage.json()) as Json;
		for (const row of firstBody.rows) expect(row.delegate_to).toBeNull();
	});

	test("NULL partition (asc): full walk over a nullable sort column visits every row exactly once", async () => {
		const expected = await unpaginatedIds(
			'delegate_to ASC NULLS LAST, "_id" ASC',
		);
		const { ids } = await walk("_sort=delegate_to&_order=asc&_limit=4");
		expect(ids).toEqual(expected);
		expect(new Set(ids).size).toBe(14);
	});

	// ── Test 7 ────────────────────────────────────────────────────────────

	test("NUMERIC beyond Number.MAX_SAFE_INTEGER sorts first (desc) and round-trips through the cursor losslessly", async () => {
		expect(Number.isSafeInteger(Number(BIG_AMOUNT))).toBe(false);
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_limit=1`,
		);
		const body = (await res.json()) as Json;
		expect(body.rows[0].amount).toBe(BIG_AMOUNT);
		expect(body.next_cursor).not.toBeNull();

		const page2 = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_limit=1&cursor=${encodeURIComponent(body.next_cursor)}`,
		);
		const body2 = (await page2.json()) as Json;
		expect(body2.rows[0]._id).not.toBe(body.rows[0]._id);
		expect(body2.rows[0].amount).toBe("100");
	});

	// ── Test 8 ────────────────────────────────────────────────────────────

	test("_sort=<jsonb column> → 400", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=meta`,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as Json;
		expect(body.code).toBe("VALIDATION_ERROR");
		expect(body.error).toMatch(/jsonb/);
	});

	test("_sort=a,b (multi-column) → 400 naming the single-column limit", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount,holder`,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as Json;
		expect(body.code).toBe("VALIDATION_ERROR");
		expect(body.error).toMatch(/single column/);
	});

	// ── Force-select / strip (mirrors the existing _id rule) ────────────────

	test("sort column is force-selected to build the cursor, then stripped when _fields excludes it", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_fields=holder&_limit=3`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.rows.length).toBe(3);
		expect(Object.keys(body.rows[0])).toEqual(["holder"]);
		// A full page still advertises a cursor — proves the sort column (like
		// `_id`) was selected server-side to build it, not silently dropped.
		expect(body.next_cursor).not.toBeNull();
	});

	test("_fields naming the sort column keeps it in the rows", async () => {
		const res = await app.request(
			`/v1/subgraphs/${SUBGRAPH_NAME}/holders?_sort=amount&_order=desc&_fields=holder,amount&_limit=3`,
		);
		const body = (await res.json()) as Json;
		expect(Object.keys(body.rows[0]).sort()).toEqual(["amount", "holder"]);
	});
});
