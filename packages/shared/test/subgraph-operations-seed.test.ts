import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db/index.ts";
import { createSubgraphOperation } from "../src/db/queries/subgraph-operations.ts";
import { registerSubgraph } from "../src/db/queries/subgraphs.ts";
import type { SubgraphOperationKind } from "../src/db/types.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("backfill cursor seeding", () => {
	let subgraphId = "";
	let subgraphName = "";

	beforeEach(async () => {
		const db = getDb();
		const subgraph = await registerSubgraph(db, {
			name: "seed-test-subgraph",
			version: "1.0.0",
			definition: {
				name: "seed-test-subgraph",
				sources: [{ contract: "SP::c" }],
				schema: {},
			},
			schemaHash: "seed-hash",
			handlerPath: "/tmp/seed-test-subgraph.ts",
		});
		subgraphId = subgraph.id;
		subgraphName = subgraph.name;
	});

	afterEach(async () => {
		await getDb().deleteFrom("subgraphs").execute();
	});

	/** An operation that ended at `cursor` before finishing. */
	async function ended(
		kind: SubgraphOperationKind,
		range: { from: number; to: number } | null,
		cursor: number | null,
	) {
		const db = getDb();
		const op = await createSubgraphOperation(db, {
			subgraphId,
			subgraphName,
			kind,
			...(range ? { fromBlock: range.from, toBlock: range.to } : {}),
		});
		await db
			.updateTable("subgraph_operations")
			.set({ status: "failed", cursor_block: cursor })
			.where("id", "=", op.id)
			.execute();
	}

	async function seedFor(from: number, to: number) {
		const op = await createSubgraphOperation(getDb(), {
			subgraphId,
			subgraphName,
			kind: "backfill",
			fromBlock: from,
			toBlock: to,
		});
		return op.cursor_block === null ? null : Number(op.cursor_block);
	}

	test("a narrower failed op never seeds a wider backfill past ranges it did not cover", async () => {
		await ended("backfill", { from: 900, to: 1000 }, 950);

		expect(await seedFor(0, 1000)).toBeNull();
	});

	test("a failed op that started at or below the new start seeds the resume point", async () => {
		await ended("backfill", { from: 0, to: 1000 }, 950);

		expect(await seedFor(0, 1000)).toBe(950);
	});

	test("an op from before the current schema was built seeds nothing", async () => {
		await ended("backfill", { from: 0, to: 1000 }, 950);
		// A reindex drops the schema, so the earlier op's progress is gone with it.
		await ended("reindex", null, null);

		expect(await seedFor(0, 1000)).toBeNull();
	});
});
