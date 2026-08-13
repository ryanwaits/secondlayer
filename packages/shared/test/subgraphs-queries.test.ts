import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getDb } from "../src/db/index.ts";
import {
	deleteSubgraph,
	getSubgraph,
	listSubgraphs,
	recordLiveError,
	recordLiveProgress,
	registerSubgraph,
	rewindLiveProgress,
	updateSubgraphStatus,
} from "../src/db/queries/subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("Subgraphs Queries", () => {
	const testDef = {
		name: "test-subgraph",
		version: "1.0.0",
		definition: {
			name: "test-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: {},
		},
		schemaHash: "abc123",
		handlerPath: "/tmp/test-subgraph.ts",
	};

	afterEach(async () => {
		const db = getDb();
		await db.deleteFrom("subgraphs").execute();
		// Clean up any PG schemas we created
		await sql
			.raw("DROP SCHEMA IF EXISTS subgraph_test_subgraph CASCADE")
			.execute(db);
	});

	afterAll(async () => {
		const db = getDb();
		await db.deleteFrom("subgraphs").execute();
	});

	test("registerSubgraph inserts a new subgraph", async () => {
		const db = getDb();
		const subgraph = await registerSubgraph(db, testDef);

		expect(subgraph.id).toBeDefined();
		expect(subgraph.name).toBe("test-subgraph");
		expect(subgraph.version).toBe("1.0.0");
		expect(subgraph.status).toBe("active");
		expect(subgraph.schema_hash).toBe("abc123");
		expect(subgraph.handler_path).toBe("/tmp/test-subgraph.ts");
		expect(Number(subgraph.last_processed_block)).toBe(0);
	});

	test("registerSubgraph upserts on conflict", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);
		const updated = await registerSubgraph(db, {
			...testDef,
			schemaHash: "def456",
			version: "2.0.0",
		});

		expect(updated.schema_hash).toBe("def456");
		expect(updated.version).toBe("2.0.0");

		// Should still be one row
		const all = await listSubgraphs(db);
		expect(all.length).toBe(1);
	});

	test("getSubgraph returns subgraph by name", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);

		const subgraph = await getSubgraph(db, "test-subgraph");
		expect(subgraph).not.toBeNull();
		expect(subgraph?.name).toBe("test-subgraph");
	});

	test("getSubgraph returns null for unknown name", async () => {
		const db = getDb();
		const subgraph = await getSubgraph(db, "nonexistent");
		expect(subgraph).toBeNull();
	});

	test("listSubgraphs returns all subgraphs", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);
		await registerSubgraph(db, { ...testDef, name: "second-subgraph" });

		const all = await listSubgraphs(db);
		expect(all.length).toBe(2);
	});

	test("updateSubgraphStatus changes status", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);

		await updateSubgraphStatus(db, "test-subgraph", "error");
		const subgraph = await getSubgraph(db, "test-subgraph");
		expect(subgraph?.status).toBe("error");
	});

	test("updateSubgraphStatus updates last_processed_block", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);

		await updateSubgraphStatus(db, "test-subgraph", "active", 5000);
		const subgraph = await getSubgraph(db, "test-subgraph");
		expect(Number(subgraph?.last_processed_block)).toBe(5000);
	});

	test("deleteSubgraph removes subgraph and drops schema", async () => {
		const db = getDb();
		await registerSubgraph(db, testDef);

		// Create the PG schema so deleteSubgraph has something to drop
		await sql
			.raw("CREATE SCHEMA IF NOT EXISTS subgraph_test_subgraph")
			.execute(db);

		const deleted = await deleteSubgraph(db, "test-subgraph");
		expect(deleted).not.toBeNull();
		expect(deleted?.name).toBe("test-subgraph");

		const subgraph = await getSubgraph(db, "test-subgraph");
		expect(subgraph).toBeNull();
	});

	test("deleteSubgraph returns null for unknown subgraph", async () => {
		const db = getDb();
		const result = await deleteSubgraph(db, "nonexistent");
		expect(result).toBeNull();
	});

	test("OSS get/list ignore account_id", async () => {
		process.env.INSTANCE_MODE = "oss";
		const db = getDb();
		await registerSubgraph(db, { ...testDef, name: "legacy-named" });
		await db
			.updateTable("subgraphs")
			.set({ account_id: "acct-leftover" })
			.where("name", "=", "legacy-named")
			.execute();

		const found = await getSubgraph(db, "legacy-named", "someone-else");
		expect(found?.name).toBe("legacy-named");
		expect(found?.account_id).toBe("acct-leftover");

		const listed = await listSubgraphs(db, "someone-else");
		expect(listed.map((s) => s.name)).toContain("legacy-named");
	});

	test("OSS register upserts by name and clears leftover account_id", async () => {
		process.env.INSTANCE_MODE = "oss";
		const db = getDb();
		await registerSubgraph(db, { ...testDef, name: "legacy-named" });
		await db
			.updateTable("subgraphs")
			.set({ account_id: "acct-leftover" })
			.where("name", "=", "legacy-named")
			.execute();

		const updated = await registerSubgraph(db, {
			...testDef,
			name: "legacy-named",
			version: "2.0.0",
			schemaHash: "next",
		});
		expect(updated.version).toBe("2.0.0");
		expect(updated.account_id).toBe("");
		expect(updated.schema_hash).toBe("next");

		const all = await listSubgraphs(db);
		expect(all.filter((s) => s.name === "legacy-named")).toHaveLength(1);
	});

	test("OSS delete removes a leftover-account row by name", async () => {
		process.env.INSTANCE_MODE = "oss";
		const db = getDb();
		await registerSubgraph(db, { ...testDef, name: "legacy-named" });
		await db
			.updateTable("subgraphs")
			.set({ account_id: "acct-leftover" })
			.where("name", "=", "legacy-named")
			.execute();

		const deleted = await deleteSubgraph(db, "legacy-named", "someone-else");
		expect(deleted?.name).toBe("legacy-named");
		expect(await getSubgraph(db, "legacy-named")).toBeNull();
	});
});

/**
 * f069: the live-path cursor writes gained a conditional guarantee — a
 * regression carrier this plan closes was `recordLiveProgress` writing
 * `last_processed_block` unconditionally, letting a laggard writer regress
 * a cursor a faster writer already advanced past.
 */
describe.skipIf(SKIP)(
	"recordLiveProgress / recordLiveError / rewindLiveProgress (f069)",
	() => {
		const testDef = {
			name: "test-subgraph",
			version: "1.0.0",
			definition: {
				name: "test-subgraph",
				sources: [{ contract: "SP::c" }],
				schema: {},
			},
			schemaHash: "abc123",
			handlerPath: "/tmp/test-subgraph.ts",
		};

		afterEach(async () => {
			const db = getDb();
			await db.deleteFrom("subgraphs").execute();
		});

		test("recordLiveProgress advances only strictly forward and reports whether it did", async () => {
			const db = getDb();
			await registerSubgraph(db, testDef);

			expect(await recordLiveProgress(db, "test-subgraph", 100)).toBe(true);
			expect(
				Number((await getSubgraph(db, "test-subgraph"))?.last_processed_block),
			).toBe(100);

			// Same height or lower: refused — no data change, no exception.
			expect(await recordLiveProgress(db, "test-subgraph", 100)).toBe(false);
			expect(await recordLiveProgress(db, "test-subgraph", 50)).toBe(false);
			expect(
				Number((await getSubgraph(db, "test-subgraph"))?.last_processed_block),
			).toBe(100);

			// Forward again: succeeds.
			expect(await recordLiveProgress(db, "test-subgraph", 101)).toBe(true);
		});

		test("recordLiveProgress promotes status toward active but never unparks reindexing", async () => {
			const db = getDb();
			await registerSubgraph(db, testDef);

			await updateSubgraphStatus(db, "test-subgraph", "reindexing");
			await recordLiveProgress(db, "test-subgraph", 10);
			expect((await getSubgraph(db, "test-subgraph"))?.status).toBe(
				"reindexing",
			);

			await updateSubgraphStatus(db, "test-subgraph", "error");
			await recordLiveProgress(db, "test-subgraph", 20);
			expect((await getSubgraph(db, "test-subgraph"))?.status).toBe("active");
		});

		test("recordLiveError stamps status=error and advances the cursor only forward", async () => {
			const db = getDb();
			await registerSubgraph(db, testDef);
			await recordLiveProgress(db, "test-subgraph", 50);

			expect(await recordLiveError(db, "test-subgraph", 60)).toBe(true);
			let row = await getSubgraph(db, "test-subgraph");
			expect(row?.status).toBe("error");
			expect(Number(row?.last_processed_block)).toBe(60);

			// A losing (behind) writer's error stamp must not regress the cursor
			// a racing writer already advanced past.
			expect(await recordLiveError(db, "test-subgraph", 55)).toBe(false);
			row = await getSubgraph(db, "test-subgraph");
			expect(Number(row?.last_processed_block)).toBe(60);
		});

		test("rewindLiveProgress moves the cursor backward unconditionally", async () => {
			const db = getDb();
			await registerSubgraph(db, testDef);
			await recordLiveProgress(db, "test-subgraph", 500);

			await rewindLiveProgress(db, "test-subgraph", 100);
			expect(
				Number((await getSubgraph(db, "test-subgraph"))?.last_processed_block),
			).toBe(100);
		});

		test("rewindLiveProgress promotes status toward active but never unparks reindexing", async () => {
			const db = getDb();
			await registerSubgraph(db, testDef);

			await updateSubgraphStatus(db, "test-subgraph", "reindexing");
			await rewindLiveProgress(db, "test-subgraph", 10);
			expect((await getSubgraph(db, "test-subgraph"))?.status).toBe(
				"reindexing",
			);
		});
	},
);
