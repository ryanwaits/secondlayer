import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getDb } from "@secondlayer/shared/db";
import {
	pgSchemaName,
	registerSubgraph,
} from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { sql } from "kysely";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter, {
	cache,
	pruneSubgraphHandlerFiles,
} from "../src/routes/subgraphs.ts";
import v1SubgraphsRouter, {
	resetAnonDirectoryCache,
} from "../src/routes/v1-subgraphs.ts";

/**
 * P3.3: OSS deploy / read / delete by unique local name, no account.
 * Visibility is ignored — a default-private row is still readable on /v1.
 */

const SKIP = !process.env.DATABASE_URL;
const NAME = "local-ns-demo";

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/api/subgraphs", subgraphsRouter);
	app.route("/v1/subgraphs", v1SubgraphsRouter);
	return app;
}

describe.skipIf(SKIP)("local namespace (oss, no account)", () => {
	const app = buildApp();
	const prevMode = process.env.INSTANCE_MODE;

	beforeAll(() => {
		process.env.INSTANCE_MODE = "oss";
	});

	afterAll(async () => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		pruneSubgraphHandlerFiles(
			join(process.env.DATA_DIR ?? "./data", "subgraphs"),
			NAME,
		);
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "=", NAME)
			.execute();
		await db.deleteFrom("subgraphs").where("name", "=", NAME).execute();
		await sql`DROP SCHEMA IF EXISTS ${sql.id(pgSchemaName(NAME))} CASCADE`.execute(
			db,
		);
	});

	test("read and delete without an account", async () => {
		resetAnonDirectoryCache();
		const db = getDb();
		await registerSubgraph(db, {
			name: NAME,
			version: "1",
			accountId: "should-be-dropped",
			schemaName: pgSchemaName(NAME),
			definition: { name: NAME, sources: {}, schema: {}, handlers: {} },
			schemaHash: "local-ns",
			handlerPath: "/tmp/local-ns.ts",
		});
		await cache.refresh();

		const listed = await app.request("/v1/subgraphs");
		expect(listed.status).toBe(200);
		const listBody = (await listed.json()) as {
			subgraphs: Array<{ name: string }>;
		};
		expect(listBody.subgraphs.some((s) => s.name === NAME)).toBe(true);

		const read = await app.request(`/v1/subgraphs/${NAME}`);
		expect(read.status).toBe(200);
		const readBody = (await read.json()) as { name: string };
		expect(readBody.name).toBe(NAME);

		const publish = await app.request(`/api/subgraphs/${NAME}/publish`, {
			method: "POST",
		});
		expect(publish.status).toBe(404);

		const deleted = await app.request(`/api/subgraphs/${NAME}`, {
			method: "DELETE",
		});
		expect(deleted.status).toBe(200);
		await cache.refresh();

		const gone = await app.request(`/v1/subgraphs/${NAME}`);
		expect(gone.status).toBe(404);
	});
});
