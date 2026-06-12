import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsApp, { cache } from "../src/routes/subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT = crypto.randomUUID();
const ACC_SG = "guard-test-accumulator";
const SAFE_SG = "guard-test-insertonly";

function appAs(accountId: string) {
	const app = new Hono();
	app.onError(errorHandler);
	app.use("*", async (c, next) => {
		// biome-ignore lint/suspicious/noExplicitAny: test middleware
		(c as any).set("accountId", accountId);
		await next();
	});
	app.route("/subgraphs", subgraphsApp);
	return app;
}

describe.skipIf(SKIP)("accumulator backfill guards", () => {
	beforeAll(async () => {
		const db = getDb();
		process.env.INSTANCE_MODE = "platform";
		await db
			.insertInto("accounts")
			.values({ id: ACCOUNT, email: `${ACCOUNT}@t.local`, plan: "scale" })
			.execute();
		for (const [name, code] of [
			[
				ACC_SG,
				'export default { handlers: { t: async (e, ctx) => { await ctx.increment("balances", { a: e.s }, "balance", 1n); } } }',
			],
			[
				SAFE_SG,
				'export default { handlers: { t: async (e, ctx) => { ctx.insert("rows", { a: e.s }); } } }',
			],
		] as const) {
			await registerSubgraph(db, {
				name,
				version: "1",
				accountId: ACCOUNT,
				schemaName: `sg_${name.replace(/-/g, "_")}`,
				definition: { name, sources: {}, schema: {}, handlers: {} },
				schemaHash: `${name}-hash`,
				handlerPath: `/tmp/${name}.ts`,
				handlerCode: code,
				startBlock: 1,
			});
		}
		await cache.refresh();
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", [ACC_SG, SAFE_SG])
			.execute();
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT).execute();
		process.env.INSTANCE_MODE = undefined;
	});

	test("backfill on an increment subgraph → 422 BACKFILL_NON_REPLAYABLE_HANDLER", async () => {
		const res = await appAs(ACCOUNT).request(`/subgraphs/${ACC_SG}/backfill`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fromBlock: 100, toBlock: 200 }),
		});
		expect(res.status).toBe(422);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		expect(((await res.json()) as any).code).toBe(
			"BACKFILL_NON_REPLAYABLE_HANDLER",
		);
	});

	test("backfill on an insert-only subgraph passes the guard", async () => {
		const res = await appAs(ACCOUNT).request(`/subgraphs/${SAFE_SG}/backfill`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fromBlock: 100, toBlock: 200 }),
		});
		// guard passed → proceeds into op creation (any non-422 outcome is fine here)
		expect(res.status).not.toBe(422);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.code).not.toBe("BACKFILL_NON_REPLAYABLE_HANDLER");
	});
});
