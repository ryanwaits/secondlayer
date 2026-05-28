import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	getSubgraph,
	registerSubgraph,
} from "@secondlayer/shared/db/queries/subgraphs";
import { handleSubgraphReorg } from "../src/runtime/reorg.ts";
import { deploySchema } from "../src/schema/deployer.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const SKIP = !process.env.DATABASE_URL;

const SUBGRAPH_NAME = "deploy-reorg-test";
const PG_SCHEMA = "subgraph_deploy_reorg_test";

const baseDef: SubgraphDefinition = {
	name: SUBGRAPH_NAME,
	version: "1.0.0",
	sources: { handler: { type: "contract_call", contractId: "SP123::test" } },
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" },
				amount: { type: "uint" },
			},
		},
	},
	handlers: { handler: async () => {} },
};

async function cleanup() {
	const db = getDb();
	const client = getRawClient();
	await client.unsafe(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
	await db.deleteFrom("subgraphs").execute();
}

// ── Deploy with forceReindex ────────────────────────────────────────────

describe.skipIf(SKIP)("Deploy with breaking changes", () => {
	beforeAll(cleanup);
	afterEach(cleanup);
	afterAll(cleanup);

	test("deploy creates new subgraph", async () => {
		const db = getDb();
		const result = await deploySchema(db, baseDef, "/tmp/handler.ts");
		expect(result.action).toBe("created");
		expect(result.subgraphId).toBeDefined();

		const sg = await getSubgraph(db, SUBGRAPH_NAME);
		expect(sg).not.toBeNull();
		expect(sg?.status).toBe("active");
	});

	test("deploy unchanged returns unchanged", async () => {
		const db = getDb();
		await deploySchema(db, baseDef, "/tmp/handler.ts");
		const result = await deploySchema(db, baseDef, "/tmp/handler.ts");
		expect(result.action).toBe("unchanged");
	});

	test("deploy with breaking change auto-reindexes on a managed DB", async () => {
		const db = getDb();
		await deploySchema(db, baseDef, "/tmp/handler.ts");

		// Seed a row so we can confirm the reindex drops existing data.
		const client = getRawClient();
		await client.unsafe(
			`INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES (1, 'tx1', 'SP_A', 100)`,
		);

		// Remove a column = breaking change
		const breakingDef: SubgraphDefinition = {
			...baseDef,
			version: "2.0.0",
			schema: {
				transfers: {
					columns: {
						sender: { type: "principal" },
						// amount removed
					},
				},
			},
		};

		// Managed deploys auto-reindex breaking changes (no forceReindex needed).
		const result = await deploySchema(db, breakingDef, "/tmp/handler.ts");
		expect(result.action).toBe("reindexed");
		expect(result.diff?.breakingChanges).toContain(
			"transfers: removed columns [amount]",
		);

		// Table recreated empty (seeded row dropped).
		const after = await client.unsafe(
			`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`,
		);
		expect(Number.parseInt(String(after[0]?.count), 10)).toBe(0);
	});

	test("deploy with breaking change + forceReindex succeeds", async () => {
		const db = getDb();
		await deploySchema(db, baseDef, "/tmp/handler.ts");

		// Insert a row into the table to verify it gets dropped
		const client = getRawClient();
		await client.unsafe(
			`INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES (1, 'tx1', 'SP_A', 100)`,
		);
		const before = await client.unsafe(
			`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`,
		);
		expect(Number.parseInt(String(before[0]?.count), 10)).toBe(1);

		// Deploy with breaking change + forceReindex
		const breakingDef: SubgraphDefinition = {
			...baseDef,
			version: "2.0.0",
			schema: {
				transfers: {
					columns: {
						sender: { type: "principal" },
						// amount removed
					},
				},
			},
		};

		const result = await deploySchema(db, breakingDef, "/tmp/handler.ts", {
			forceReindex: true,
		});
		expect(result.action).toBe("reindexed");

		// Table should be recreated (empty)
		const after = await client.unsafe(
			`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`,
		);
		expect(Number.parseInt(String(after[0]?.count), 10)).toBe(0);

		// Verify new schema only has "sender" column (no "amount")
		const cols = await client.unsafe(
			`SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'transfers'
       ORDER BY ordinal_position`,
		);
		const colNames = cols.map((r: Record<string, unknown>) => r.column_name);
		expect(colNames).toContain("sender");
		expect(colNames).not.toContain("amount");
		expect(colNames).toContain("_id");
		expect(colNames).toContain("_block_height");
	});

	test("deploy with additive change succeeds without forceReindex", async () => {
		const db = getDb();
		await deploySchema(db, baseDef, "/tmp/handler.ts");

		const additiveDef: SubgraphDefinition = {
			...baseDef,
			version: "1.1.0",
			schema: {
				transfers: {
					columns: {
						sender: { type: "principal" },
						amount: { type: "uint" },
						memo: { type: "text", nullable: true },
					},
				},
			},
		};

		const result = await deploySchema(db, additiveDef, "/tmp/handler.ts");
		expect(result.action).toBe("updated");

		// Verify new column exists
		const client = getRawClient();
		const cols = await client.unsafe(
			`SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'transfers'`,
		);
		const colNames = cols.map((r: Record<string, unknown>) => r.column_name);
		expect(colNames).toContain("memo");
	});
});

// ── Reorg propagation ───────────────────────────────────────────────────

describe.skipIf(SKIP)("Reorg propagation to subgraphs", () => {
	beforeAll(cleanup);
	afterEach(cleanup);
	afterAll(cleanup);

	test("handleSubgraphReorg deletes rows at and above the reorged block height", async () => {
		const db = getDb();
		const client = getRawClient();

		// Deploy subgraph and insert data at different block heights
		await deploySchema(db, baseDef, "/tmp/handler.ts");

		await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
        (100, 'tx1', 'SP_A', 1000),
        (101, 'tx2', 'SP_B', 2000),
        (102, 'tx3', 'SP_C', 3000),
        (103, 'tx4', 'SP_D', 4000)
    `);

		const beforeCount = await client.unsafe(
			`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`,
		);
		expect(Number.parseInt(String(beforeCount[0]?.count), 10)).toBe(4);

		// Reorg root at block 102. A Stacks reorg reverts every block ≥ the
		// root, so heights 102 and 103 are removed; 100 and 101 remain.
		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(102, mockLoadDef);

		const remaining = await client.unsafe(
			`SELECT DISTINCT "_block_height" FROM ${PG_SCHEMA}.transfers ORDER BY "_block_height"`,
		);
		expect(
			remaining.map((r: Record<string, unknown>) => Number(r._block_height)),
		).toEqual([100, 101]);
	});

	test("handleSubgraphReorg skips subgraphs without schema definition", async () => {
		const db = getDb();

		// Register a subgraph with no schema in definition
		await registerSubgraph(db, {
			name: SUBGRAPH_NAME,
			version: "1.0.0",
			definition: {
				name: SUBGRAPH_NAME,
				sources: { handler: { type: "contract_call", contractId: "SP::c" } },
			},
			schemaHash: "abc",
			handlerPath: "/tmp/handler.ts",
		});

		// Should not throw
		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(100, mockLoadDef);
	});

	test("handleSubgraphReorg leaves heights below the root untouched", async () => {
		const db = getDb();
		const client = getRawClient();

		await deploySchema(db, baseDef, "/tmp/handler.ts");

		await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
        (200, 'tx1', 'SP_A', 1000),
        (201, 'tx2', 'SP_B', 2000),
        (202, 'tx3', 'SP_C', 3000)
    `);

		const mockLoadDef = async (_sg: Subgraph) => baseDef;
		await handleSubgraphReorg(201, mockLoadDef);

		// Blocks 201 and 202 (≥ root) are reverted; only 200 remains.
		const rows = await client.unsafe(
			`SELECT "_block_height" FROM ${PG_SCHEMA}.transfers ORDER BY "_block_height"`,
		);
		expect(
			rows.map((r: Record<string, unknown>) => Number(r._block_height)),
		).toEqual([200]);
	});
});
