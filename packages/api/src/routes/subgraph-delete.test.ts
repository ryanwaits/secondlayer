import { afterAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { createSubgraphOperation } from "@secondlayer/shared/db/queries/subgraph-operations";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import subgraphsRouter, {
	DELETE_OPERATION_WAIT_MS,
	cache,
} from "./subgraphs.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const names: string[] = [];

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/api/subgraphs", subgraphsRouter);
	return a;
}

/** A subgraph with one running reindex whose lock expires `lockSeconds` from now. */
async function seedRunningReindex(lockSeconds: number): Promise<string> {
	const name = `delete-test-${crypto.randomUUID().slice(0, 8)}`;
	names.push(name);
	const subgraph = await registerSubgraph(db, {
		name,
		version: "1.0.0",
		definition: {},
		schemaHash: "h",
		handlerPath: "/data/subgraphs/x.js",
	});
	const op = await createSubgraphOperation(db, {
		subgraphId: subgraph.id,
		subgraphName: name,
		kind: "reindex",
	});
	await db
		.updateTable("subgraph_operations")
		.set({
			status: "running",
			locked_by: "runner-that-may-be-dead",
			locked_until: sql<Date>`now() + ${`${lockSeconds} seconds`}::interval`,
		})
		.where("id", "=", op.id)
		.execute();
	await cache.refresh();
	return name;
}

async function timedDelete(name: string) {
	const started = performance.now();
	const res = await app().request(`/api/subgraphs/${name}`, {
		method: "DELETE",
	});
	return { res, ms: performance.now() - started };
}

afterAll(async () => {
	if (!HAS_DB || names.length === 0) return;
	await db.deleteFrom("subgraphs").where("name", "in", names).execute();
});

describe.skipIf(!HAS_DB)(
	"DELETE /api/subgraphs/:name with an active reindex",
	() => {
		test("an operation whose runner is gone (lapsed lock) is taken over, not waited out", async () => {
			const name = await seedRunningReindex(-30);

			const { res, ms } = await timedDelete(name);

			expect(res.status).toBe(200);
			expect(ms).toBeLessThan(DELETE_OPERATION_WAIT_MS / 2);
		});

		test("an operation with a live lock is left alone and waited on up to the bound", async () => {
			const name = await seedRunningReindex(60);

			const { res, ms } = await timedDelete(name);

			expect(res.status).toBe(200);
			expect(ms).toBeGreaterThanOrEqual(DELETE_OPERATION_WAIT_MS - 500);
			expect(ms).toBeLessThan(DELETE_OPERATION_WAIT_MS + 3_000);
		}, 20_000);
	},
);
