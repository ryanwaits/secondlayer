import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createSubgraphOperation } from "@secondlayer/shared/db/queries/subgraph-operations";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import subgraphsRouter from "./subgraphs.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const names: string[] = [];

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/api/subgraphs", subgraphsRouter);
	return a;
}

function halt(name: string, body: unknown) {
	return app().request(`/api/subgraphs/${name}/halt`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

afterAll(async () => {
	if (!HAS_DB || names.length === 0) return;
	await db.deleteFrom("subgraphs").where("name", "in", names).execute();
});

describe.skipIf(!HAS_DB)("POST /api/subgraphs/:name/halt", () => {
	test("marks the subgraph error and records the reason", async () => {
		const name = `halt-test-${crypto.randomUUID().slice(0, 8)}`;
		names.push(name);
		await registerSubgraph(db, {
			name,
			version: "1.0.0",
			definition: {},
			schemaHash: "h",
			handlerPath: "/data/subgraphs/x.js",
		});

		const res = await halt(name, { reason: "handler stalled at block 100" });
		expect(res.status).toBe(200);

		const row = await db
			.selectFrom("subgraphs")
			.select(["status", "last_error", "last_error_at"])
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(row.status).toBe("error");
		expect(row.last_error).toBe("handler stalled at block 100");
		expect(row.last_error_at).not.toBeNull();
	});

	test("cancels the subgraph's active operations so a halted reindex does not resume", async () => {
		const name = `halt-test-${crypto.randomUUID().slice(0, 8)}`;
		names.push(name);
		const subgraph = await registerSubgraph(db, {
			name,
			version: "1.0.0",
			definition: {},
			schemaHash: "h",
			handlerPath: "/data/subgraphs/x.js",
		});
		const reindex = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName: name,
			kind: "reindex",
		});

		const res = await halt(name, { reason: "out of memory at block 500" });
		expect(res.status).toBe(200);

		const op = await db
			.selectFrom("subgraph_operations")
			.select("cancel_requested")
			.where("id", "=", reindex.id)
			.executeTakeFirstOrThrow();
		expect(op.cancel_requested).toBe(true);
	});

	test("an unknown subgraph is a 404", async () => {
		const res = await halt("does-not-exist", { reason: "x" });
		expect(res.status).toBe(404);
	});

	test("a missing reason is a 400", async () => {
		const name = `halt-test-${crypto.randomUUID().slice(0, 8)}`;
		names.push(name);
		await registerSubgraph(db, {
			name,
			version: "1.0.0",
			definition: {},
			schemaHash: "h",
			handlerPath: "/data/subgraphs/x.js",
		});
		expect((await halt(name, {})).status).toBe(400);
		expect((await halt(name, { reason: "  " })).status).toBe(400);
	});
});
