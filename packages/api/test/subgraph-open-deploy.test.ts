import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { sql } from "kysely";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter, {
	cache,
	pruneSubgraphHandlerFiles,
} from "../src/routes/subgraphs.ts";

/**
 * Deploys are open on every instance — authorization never consults a plan,
 * trial, or quota. A bare platform-mode account (accounts carry no plan
 * column at all) deploys from genesis, backfills history, and flips to
 * private without hitting any commerce gate. The only metered surface is
 * archive-data access, which lives elsewhere.
 */

const SKIP = !process.env.DATABASE_URL;
const NAME = "open-deploy-demo";
const ACCOUNT = crypto.randomUUID();

function appAs(accountId: string) {
	const app = new Hono<{ Variables: { accountId: string } }>();
	app.onError(errorHandler);
	app.use("/subgraphs/*", async (c, next) => {
		c.set("accountId", accountId);
		await next();
	});
	app.route("/subgraphs", subgraphsRouter);
	return app;
}

function deployBody(name: string, startBlock?: number) {
	const schema = { rows: { columns: { amount: { type: "uint" } } } };
	const source = {
		type: "print_event",
		contractId: "SP123.open-deploy",
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
	return {
		name,
		sources: { prints: source },
		schema,
		handlerCode,
		...(startBlock !== undefined ? { startBlock } : {}),
	};
}

describe.skipIf(SKIP)("open deploy (platform, no plan gates)", () => {
	let prevMode: string | undefined;
	const app = appAs(ACCOUNT);

	beforeAll(async () => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		await getDb()
			.insertInto("accounts")
			.values({ id: ACCOUNT, email: `${ACCOUNT}@test.local` })
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();
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
		const row = await db
			.selectFrom("subgraphs")
			.select("schema_name")
			.where("name", "=", NAME)
			.executeTakeFirst();
		await db.deleteFrom("subgraphs").where("name", "=", NAME).execute();
		if (row?.schema_name) {
			await sql`DROP SCHEMA IF EXISTS ${sql.id(row.schema_name)} CASCADE`.execute(
				db,
			);
		}
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT).execute();
		await cache.refresh();
	});

	test("new deploy needs no plan/trial; genesis start is honored unclamped", async () => {
		const res = await app.request("/subgraphs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(deployBody(NAME, 1)),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			action: string;
			start_block: number;
			start_block_clamped?: boolean;
			code?: string;
		};
		expect(body.action).toBe("created");
		expect(body.code).toBeUndefined();
		// Genesis start honored as requested — no forward-only clamp exists.
		expect(body.start_block).toBe(1);
		expect(body.start_block_clamped).toBeUndefined();
		await cache.refresh();
	});

	test("historical backfill is never a paid action", async () => {
		const res = await app.request(`/subgraphs/${NAME}/backfill`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fromBlock: 1, toBlock: 100 }),
		});
		// Deploy already queued a reindex — 409 is the op lock, not a gate.
		expect([200, 409]).toContain(res.status);
		const body = (await res.json()) as { code?: string };
		expect(body.code).not.toBe("GENESIS_BACKFILL_REQUIRES_PLAN");
		expect(body.code).not.toBe("PLAN_REQUIRED");
	});

	test("private visibility needs no plan", async () => {
		const res = await app.request(`/subgraphs/${NAME}/unpublish`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { visibility: string };
		expect(body.visibility).toBe("private");
	});
});
