import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { sql } from "kysely";
import { replaySubscription } from "../src/runtime/replay.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

const SUBGRAPH_NAME = "replay-keyset-test-subgraph";
const PG_SCHEMA = "subgraph_replay_keyset_test";
const TABLE_NAME = "widgets";

// `TIE_BLOCK` carries `TIE_ROWS` (5,000) rows that all share one
// `_block_height` and — because they're written in a single INSERT/
// transaction, matching how the runtime writes `_created_at = NOW()`
// (context.ts:727) — one identical `_created_at` too. That is exactly the
// condition the old `ORDER BY _block_height, _created_at ... LIMIT n OFFSET
// m` query cannot break ties on.
//
// Verified directly against local Postgres (5,000 tied rows, ANALYZE'd):
// paging that query with LIMIT 500 deterministically skips row `_id=501`,
// every run. The planner picks a bounded top-N heapsort for the
// small-bound first page (LIMIT 500 OFFSET 0) and a full quicksort for a
// later, larger-bound page (LIMIT 500 OFFSET 4500) — confirmed via
// `EXPLAIN ANALYZE` ("Sort Method: top-N heapsort" vs "Sort Method:
// quicksort") — and the two algorithms don't agree on tie order. `_id`
// keyset pagination has no ties to resolve, so it can't reproduce this.
//
// `OTHER_BLOCK` adds a second, smaller block so the fixture also covers a
// range spanning more than one block height.
const TIE_BLOCK = 500001;
const TIE_ROWS = 5000;
const OTHER_BLOCK = 500002;
const OTHER_ROWS = 7;
const TOTAL_ROWS = TIE_ROWS + OTHER_ROWS;

describe.skipIf(!HAS_DB)("replaySubscription pages by _id keyset", () => {
	let accountId: string;
	let subscriptionId: string;

	beforeAll(async () => {
		const db = getDb();
		accountId = randomUUID();

		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);

		await registerSubgraph(db, {
			name: SUBGRAPH_NAME,
			version: "1.0.0",
			definition: {
				name: SUBGRAPH_NAME,
				sources: [{ contract: "SP123::replay-keyset-fixture" }],
				schema: {
					[TABLE_NAME]: {
						columns: {
							label: { type: "text" },
						},
					},
				},
			},
			schemaHash: "replay-keyset-test-hash",
			handlerPath: "/tmp/replay-keyset-test.js",
			schemaName: PG_SCHEMA,
		});

		const client = getRawClient();
		await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
		await client.unsafe(`
			CREATE TABLE ${PG_SCHEMA}.${TABLE_NAME} (
				"_id" BIGSERIAL PRIMARY KEY,
				"_block_height" BIGINT NOT NULL,
				"_tx_id" TEXT NOT NULL,
				"_created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				"label" TEXT NOT NULL
			)
		`);

		// One INSERT per block height keeps every row for that block on the same
		// transaction's NOW(), so `_created_at` ties within the block exactly as
		// it does in production.
		await client.unsafe(`
			INSERT INTO ${PG_SCHEMA}.${TABLE_NAME} ("_block_height", "_tx_id", "label")
			SELECT ${TIE_BLOCK}, 'tx-tie-' || g, 'tie-' || g
			FROM generate_series(1, ${TIE_ROWS}) g
		`);
		await client.unsafe(`
			INSERT INTO ${PG_SCHEMA}.${TABLE_NAME} ("_block_height", "_tx_id", "label")
			SELECT ${OTHER_BLOCK}, 'tx-other-' || g, 'other-' || g
			FROM generate_series(1, ${OTHER_ROWS}) g
		`);
		// Without ANALYZE, the planner underestimates row counts on a freshly
		// loaded table and picks a full sort for every page regardless of
		// OFFSET — which happens to agree on tie order and would mask the bug.
		// ANALYZE lets it choose a bounded top-N heapsort for the small-offset
		// first page and a full quicksort for later, larger-offset pages: the
		// real-world condition this fix guards against.
		await client.unsafe(`ANALYZE ${PG_SCHEMA}.${TABLE_NAME}`);

		const { subscription } = await createSubscription(db, {
			accountId,
			kind: "subgraph",
			name: `replay-keyset-${randomUUID().slice(0, 8)}`,
			subgraphName: SUBGRAPH_NAME,
			tableName: TABLE_NAME,
			url: "https://example.com/replay-keyset-webhook",
		});
		subscriptionId = subscription.id;
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subscription_outbox")
			.where("subscription_id", "=", subscriptionId)
			.execute();
		await db
			.deleteFrom("subscriptions")
			.where("id", "=", subscriptionId)
			.execute();
		await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
	});

	test("replays a >BATCH_SIZE tie block plus a second block with zero skips", async () => {
		const result = await replaySubscription({
			accountId,
			subscriptionId,
			fromBlock: TIE_BLOCK,
			toBlock: OTHER_BLOCK,
		});

		expect(result.scannedCount).toBe(TOTAL_ROWS);
		expect(result.enqueuedCount).toBe(TOTAL_ROWS);

		const db = getDb();
		const outboxRows = await db
			.selectFrom("subscription_outbox")
			.select(["dedup_key"])
			.where("subscription_id", "=", subscriptionId)
			.execute();
		expect(outboxRows).toHaveLength(TOTAL_ROWS);
		expect(new Set(outboxRows.map((r) => r.dedup_key)).size).toBe(TOTAL_ROWS);
	});

	test("re-running the same replay range enqueues nothing new (idempotency holds)", async () => {
		const result = await replaySubscription({
			accountId,
			subscriptionId,
			fromBlock: TIE_BLOCK,
			toBlock: OTHER_BLOCK,
		});

		expect(result.scannedCount).toBe(TOTAL_ROWS);
		expect(result.enqueuedCount).toBe(0);

		const db = getDb();
		const outboxRows = await db
			.selectFrom("subscription_outbox")
			.select(["dedup_key"])
			.where("subscription_id", "=", subscriptionId)
			.execute();
		expect(outboxRows).toHaveLength(TOTAL_ROWS);
	});
});
