import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import { deleteSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { flushHandlerErrors, recordHandlerError } from "./error-groups.ts";
import { StatsAccumulator } from "./stats.ts";
import { recordPrintViolation } from "./violations.ts";

/**
 * Violations, handler error groups and processing stats belong to a subgraph
 * row, not to its name: a subgraph deleted and registered again under the same
 * name starts with none of them.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

const names: string[] = [];

async function register(name: string): Promise<string> {
	names.push(name);
	const row = await getDb()
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: { name },
			schema_hash: "test",
			handler_path: "test",
			schema_name: `sg_sidetables_${name.replace(/-/g, "_")}`,
			account_id: randomUUID(),
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

async function rowsNamed(table: string, name: string): Promise<number> {
	const { rows } = await sql<{ n: string }>`
		SELECT count(*)::text AS n FROM ${sql.table(table)} WHERE subgraph_name = ${name}
	`.execute(getDb());
	return Number(rows[0]?.n);
}

afterAll(async () => {
	if (!HAS_DB) return;
	for (const name of names) {
		await getDb().deleteFrom("subgraphs").where("name", "=", name).execute();
	}
});

describe.skipIf(!HAS_DB)("side tables follow the subgraph row", () => {
	test("a subgraph registered again under a deleted name starts with no violations, error groups or stats", async () => {
		const name = `sidetables-${randomUUID().slice(0, 8)}`;
		const oldId = await register(name);

		await recordPrintViolation({
			subgraphId: oldId,
			subgraphName: name,
			sourceName: "prints",
			blockHeight: 10,
			txId: "0xtx",
			reason: "mismatch",
			samplePayload: {},
		});
		recordHandlerError({
			subgraphId: oldId,
			subgraphName: name,
			sourceName: "burns",
			eventType: "ft_burn",
			txId: "0xtx",
			blockHeight: 10,
			err: new Error("boom"),
		});
		await flushHandlerErrors();
		const stats = new StatsAccumulator(oldId, name, false);
		stats.record({ totalMs: 5, handlerMs: 3, flushMs: 1 }, 2);
		await stats.flush(getDb());

		expect(await rowsNamed("subgraph_violations", name)).toBe(1);
		expect(await rowsNamed("subgraph_error_groups", name)).toBe(1);
		expect(await rowsNamed("subgraph_processing_stats", name)).toBe(1);

		await deleteSubgraph(getDb(), name);
		const newId = await register(name);
		expect(newId).not.toBe(oldId);

		expect(await rowsNamed("subgraph_violations", name)).toBe(0);
		expect(await rowsNamed("subgraph_error_groups", name)).toBe(0);
		expect(await rowsNamed("subgraph_processing_stats", name)).toBe(0);
	});

	test("one subgraph's violations are capped without touching another's", async () => {
		const first = `sidetables-a-${randomUUID().slice(0, 8)}`;
		const second = `sidetables-b-${randomUUID().slice(0, 8)}`;
		const firstId = await register(first);
		const secondId = await register(second);
		const violation = (subgraphId: string, subgraphName: string) => ({
			subgraphId,
			subgraphName,
			sourceName: "prints",
			blockHeight: 1,
			txId: "0xtx",
			reason: "mismatch",
			samplePayload: {},
		});

		await recordPrintViolation(violation(secondId, second));
		for (let i = 0; i < 101; i++) {
			await recordPrintViolation(violation(firstId, first));
		}

		expect(await rowsNamed("subgraph_violations", first)).toBe(100);
		expect(await rowsNamed("subgraph_violations", second)).toBe(1);
	});
});
