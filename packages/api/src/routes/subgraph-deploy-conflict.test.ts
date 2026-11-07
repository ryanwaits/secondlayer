import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { sql } from "kysely";
import { errorHandler } from "../middleware/error.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const names: string[] = [];
let prevDataDir: string | undefined;
let router: Hono;

beforeAll(async () => {
	if (!HAS_DB) return;
	prevDataDir = process.env.DATA_DIR;
	// DATA_DIR is read when the router module loads: point it at a scratch dir.
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sg-deploy-"));
	const { default: subgraphsRouter } = await import("./subgraphs.ts");
	router = new Hono();
	router.onError(errorHandler);
	router.route("/api/subgraphs", subgraphsRouter);
});

afterAll(async () => {
	if (prevDataDir === undefined)
		Reflect.deleteProperty(process.env, "DATA_DIR");
	else process.env.DATA_DIR = prevDataDir;
	if (!HAS_DB || names.length === 0) return;
	const rows = await db
		.selectFrom("subgraphs")
		.select("schema_name")
		.where("name", "in", names)
		.execute();
	for (const row of rows) {
		await sql
			.raw(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`)
			.execute(db);
	}
	await db.deleteFrom("subgraphs").where("name", "in", names).execute();
});

const bundle = (name: string, columns: string[]) => `
function defineSubgraph(d) { return d; }
var subgraph_default = defineSubgraph({
	name: ${JSON.stringify(name)},
	sources: { s: { type: "stx_transfer" } },
	schema: { rows: { columns: { ${columns.map((c) => `${c}: { type: "text" }`).join(", ")} } } },
	handlers: { s: () => {} },
});
export { subgraph_default as default };
`;

function deploy(name: string, columns: string[]) {
	return router.request("/api/subgraphs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name,
			sources: { s: { type: "stx_transfer" } },
			schema: {
				rows: {
					columns: Object.fromEntries(
						columns.map((c) => [c, { type: "text" }]),
					),
				},
			},
			handlerCode: bundle(name, columns),
		}),
	});
}

async function tableColumns(schemaName: string | null): Promise<string[]> {
	const res = await sql<{ column_name: string }>`
		SELECT column_name FROM information_schema.columns
		WHERE table_schema = ${schemaName} AND table_name = 'rows'
	`.execute(db);
	return res.rows.map((r) => r.column_name);
}

describe.skipIf(!HAS_DB)("POST /api/subgraphs redeploy", () => {
	test("a rebuilding redeploy during an active operation returns 409 and leaves the schema and registry untouched", async () => {
		const name = `deploy-conflict-${crypto.randomUUID().slice(0, 8)}`;
		names.push(name);

		// First deploy creates the subgraph and queues its initial reindex.
		const first = await deploy(name, ["a", "b"]);
		expect(first.status, await first.clone().text()).toBe(201);
		const before = await db
			.selectFrom("subgraphs")
			.select(["schema_name", "schema_hash", "version"])
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(await tableColumns(before.schema_name)).toContain("b");

		// Dropping a column is a breaking change: deploySchema would drop the
		// schema, but the queued reindex still holds the operation slot.
		const second = await deploy(name, ["a"]);

		expect(second.status).toBe(409);
		expect(((await second.json()) as { code: string }).code).toBe(
			"OPERATION_IN_PROGRESS",
		);
		const after = await db
			.selectFrom("subgraphs")
			.select(["schema_name", "schema_hash", "version"])
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(after).toEqual(before);
		expect(await tableColumns(after.schema_name)).toContain("b");
	});
});
