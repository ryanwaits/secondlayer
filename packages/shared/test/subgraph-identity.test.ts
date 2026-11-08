import { afterEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db/index.ts";
import { pgSchemaName } from "../src/db/queries/subgraphs.ts";
import { registerSubgraph } from "../src/db/queries/subgraphs.ts";
import { DeploySubgraphRequestSchema } from "../src/schemas/subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

function nameIssues(name: string) {
	const parsed = DeploySubgraphRequestSchema.safeParse({ name });
	return parsed.success
		? []
		: parsed.error.issues.filter((i) => i.path[0] === "name");
}

describe("subgraph names fit their schema name", () => {
	test("the longest accepted name still yields a schema within 63 bytes", () => {
		const name = "a".repeat(54);
		expect(nameIssues(name)).toEqual([]);
		expect(pgSchemaName(name).length).toBeLessThanOrEqual(63);
	});

	test("a name whose schema would be truncated is rejected", () => {
		expect(nameIssues("a".repeat(55)).length).toBeGreaterThan(0);
	});
});

describe.skipIf(SKIP)("schema names are unique", () => {
	afterEach(async () => {
		await getDb().deleteFrom("subgraphs").execute();
	});

	const base = {
		version: "1.0.0",
		definition: { sources: [{ contract: "SP::c" }], schema: {} },
		schemaHash: "identity-hash",
		handlerPath: "/tmp/identity.ts",
	};

	test("two subgraphs cannot share one Postgres schema", async () => {
		const db = getDb();
		await registerSubgraph(db, {
			...base,
			name: "identity-one",
			schemaName: "subgraph_shared_schema",
		});

		await expect(
			registerSubgraph(db, {
				...base,
				name: "identity-two",
				schemaName: "subgraph_shared_schema",
			}),
		).rejects.toThrow(/subgraphs_schema_name_unique/);
	});
});
