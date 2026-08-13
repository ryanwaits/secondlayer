import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getDb } from "@secondlayer/shared/db";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
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
 * P3.4: OSS deploy / reindex / backfill from an empty commerce plane —
 * no accounts, plans, credits, expiry, or hosted x402.
 */

const SKIP = !process.env.DATABASE_URL;
const NAME = "local-deploy-gates-demo";

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/api/subgraphs", subgraphsRouter);
	app.route("/v1/subgraphs", v1SubgraphsRouter);
	return app;
}

function deployBody(name: string) {
	const schema = { rows: { columns: { amount: { type: "uint" } } } };
	const source = {
		type: "print_event",
		contractId: "SP123.local-gates",
		topic: "tick",
	};
	const handlerCode = [
		"export default defineSubgraph({",
		`  name: ${JSON.stringify(name)},`,
		`  sources: { prints: ${JSON.stringify(source)} },`,
		`  schema: ${JSON.stringify(schema)},`,
		"  handlers: { prints: async (event, ctx) => {} },",
		"});",
	].join("\n");
	return { name, sources: { prints: source }, schema, handlerCode };
}

async function accountCount(): Promise<number> {
	const row = await getDb()
		.selectFrom("accounts")
		.select((eb) => eb.fn.countAll().as("n"))
		.executeTakeFirstOrThrow();
	return Number(row.n);
}

describe.skipIf(SKIP)("local deploy gates (oss, no commerce)", () => {
	const app = buildApp();
	const prevMode = process.env.INSTANCE_MODE;

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

	test("deploy, reindex, and backfill without accounts or expiry", async () => {
		process.env.INSTANCE_MODE = "oss";
		resetAnonDirectoryCache();
		const before = await accountCount();

		const created = await app.request("/api/subgraphs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(deployBody(NAME)),
		});
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as {
			action: string;
			expires_at?: string;
		};
		expect(createdBody.action).toBe("created");
		expect(createdBody.expires_at).toBeUndefined();
		await cache.refresh();

		const row = await getDb()
			.selectFrom("subgraphs")
			.select(["expires_at", "account_id"])
			.where("name", "=", NAME)
			.executeTakeFirstOrThrow();
		expect(row.expires_at).toBeNull();
		expect(row.account_id).toBe("");

		const reindex = await app.request(`/api/subgraphs/${NAME}/reindex`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		// Deploy already queued a reindex — 409 is an op lock, not a commerce gate.
		expect([200, 409]).toContain(reindex.status);
		const reindexBody = (await reindex.json()) as { code?: string };
		expect(reindexBody.code).not.toBe("PLAN_REQUIRED");
		expect(reindexBody.code).not.toBe("GENESIS_BACKFILL_REQUIRES_PLAN");

		const backfill = await app.request(`/api/subgraphs/${NAME}/backfill`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fromBlock: 1, toBlock: 2 }),
		});
		expect([200, 409]).toContain(backfill.status);
		const backfillBody = (await backfill.json()) as { code?: string };
		expect(backfillBody.code).not.toBe("GENESIS_BACKFILL_REQUIRES_PLAN");

		const paid = await app.request("/v1/subgraphs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(deployBody(`${NAME}-paid`)),
		});
		// Unmounted (404) or rail off (503) — neither mints a ghost account.
		expect([404, 503]).toContain(paid.status);

		expect(await accountCount()).toBe(before);
	});
});
