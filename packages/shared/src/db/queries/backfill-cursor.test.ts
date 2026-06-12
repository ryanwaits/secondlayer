import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "../index.ts";
import {
	advanceOperationCursor,
	createSubgraphOperation,
} from "./subgraph-operations.ts";
import { registerSubgraph } from "./subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("backfill op cursor", () => {
	const ACCOUNT = crypto.randomUUID();
	const SG = "opcursor-test-sg";
	let subgraphId: string;
	let opId: string;

	beforeAll(async () => {
		const db = getDb();
		await db
			.insertInto("accounts")
			.values({ id: ACCOUNT, email: `${ACCOUNT}@t.local`, plan: "scale" })
			.execute();
		await registerSubgraph(db, {
			name: SG,
			version: "1",
			accountId: ACCOUNT,
			schemaName: "sg_opcursor_test",
			definition: { name: SG, sources: {}, schema: {}, handlers: {} },
			schemaHash: `${SG}-hash`,
			handlerPath: `/tmp/${SG}.ts`,
			startBlock: 1,
		});
		subgraphId = (
			await db
				.selectFrom("subgraphs")
				.select("id")
				.where("name", "=", SG)
				.executeTakeFirstOrThrow()
		).id;
		const op = await createSubgraphOperation(db, {
			subgraphId,
			subgraphName: SG,
			accountId: ACCOUNT,
			kind: "backfill",
			fromBlock: 1,
			toBlock: 1000,
		});
		opId = op.id;
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "=", SG)
			.execute();
		await db.deleteFrom("subgraphs").where("name", "=", SG).execute();
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT).execute();
	});

	test("advance is monotonic: forward wins, backward/equal lose", async () => {
		const db = getDb();
		expect(await advanceOperationCursor(db, opId, 100)).toBe(true);
		expect(await advanceOperationCursor(db, opId, 100)).toBe(false); // equal
		expect(await advanceOperationCursor(db, opId, 50)).toBe(false); // backward
		expect(await advanceOperationCursor(db, opId, 101)).toBe(true);
	});

	test("two-writer race: exactly one conditional advance wins per height", async () => {
		const db = getDb();
		// Two REAL parallel transactions contending the same height. The row
		// lock serializes them; the loser's WHERE re-evaluates post-commit and
		// matches zero rows. This is the multi-replica zombie scenario.
		const contend = (h: number) =>
			db.transaction().execute(async (tx) => {
				return advanceOperationCursor(tx, opId, h);
			});
		const [a, b] = await Promise.all([contend(500), contend(500)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		// and the cursor landed exactly once
		const row = await db
			.selectFrom("subgraph_operations")
			.select("cursor_block")
			.where("id", "=", opId)
			.executeTakeFirstOrThrow();
		expect(Number(row.cursor_block)).toBe(500);
	});

	test("requeued backfill seeds cursor from prior terminal attempt's prefix", async () => {
		const db = getDb();
		// terminal-ize the first op with its committed prefix
		await db
			.updateTable("subgraph_operations")
			.set({ status: "cancelled", finished_at: new Date() })
			.where("id", "=", opId)
			.execute();
		const requeued = await createSubgraphOperation(db, {
			subgraphId,
			subgraphName: SG,
			accountId: ACCOUNT,
			kind: "backfill",
			fromBlock: 1,
			toBlock: 1000,
		});
		expect(Number(requeued.cursor_block)).toBe(500);
		// non-overlapping range does NOT inherit
		await db
			.updateTable("subgraph_operations")
			.set({ status: "cancelled", finished_at: new Date() })
			.where("id", "=", requeued.id)
			.execute();
		const elsewhere = await createSubgraphOperation(db, {
			subgraphId,
			subgraphName: SG,
			accountId: ACCOUNT,
			kind: "backfill",
			fromBlock: 2000,
			toBlock: 3000,
		});
		expect(elsewhere.cursor_block).toBeNull();
	});
});
