import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getDb } from "../src/db/index.ts";
import {
	deleteSubgraph,
	getSubgraph,
	listSubgraphs,
	registerSubgraph,
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
});
