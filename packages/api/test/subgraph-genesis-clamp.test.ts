import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter, { cache } from "../src/routes/subgraphs.ts";
import {
	clampDeployStartBlock,
	genesisExemptAccountIds,
	resolveGenesisPolicy,
} from "../src/subgraphs/plan-limits.ts";

const SKIP = !process.env.DATABASE_URL;

// ── clampDeployStartBlock (pure) ─────────────────────────────────────────

describe("clampDeployStartBlock", () => {
	const tip = 1_000_000;

	test("genesis allowed → passthrough", () => {
		expect(
			clampDeployStartBlock({
				genesisAllowed: true,
				requested: 1,
				existingStartBlock: undefined,
				chainTip: tip,
			}),
		).toEqual({ startBlock: 1, clamped: false });
	});

	test("new deploy, no request → tip (clamped vs genesis default)", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: undefined,
			existingStartBlock: undefined,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(tip);
		expect(r.clamped).toBe(true);
	});

	test("new deploy, historical request → tip + clamped", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: 1,
			existingStartBlock: undefined,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(tip);
		expect(r.clamped).toBe(true);
	});

	test("new deploy, forward request past tip → honored", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: tip + 50,
			existingStartBlock: undefined,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(tip + 50);
		expect(r.clamped).toBe(false);
	});

	test("redeploy, no request → preserves registered start", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: undefined,
			existingStartBlock: 900_000,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(900_000);
		expect(r.clamped).toBe(false);
	});

	test("redeploy, request below registered start → floored + clamped", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: 1,
			existingStartBlock: 900_000,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(900_000);
		expect(r.clamped).toBe(true);
	});

	test("redeploy, forward move → honored (reduces work)", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: 950_000,
			existingStartBlock: 900_000,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(950_000);
		expect(r.clamped).toBe(false);
	});

	test("legacy row (start 0) is grandfathered", () => {
		const r = clampDeployStartBlock({
			genesisAllowed: false,
			requested: 1,
			existingStartBlock: 0,
			chainTip: tip,
		});
		expect(r.startBlock).toBe(1);
		expect(r.clamped).toBe(false);
	});
});

describe("genesisExemptAccountIds", () => {
	test("parses comma list, trims, drops blanks", () => {
		const ids = genesisExemptAccountIds({
			SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS: " a-1, b-2 ,, ",
		} as NodeJS.ProcessEnv);
		expect(ids).toEqual(new Set(["a-1", "b-2"]));
	});
});

// ── resolveGenesisPolicy + route enforcement (DB) ────────────────────────

describe.skipIf(SKIP)("genesis policy (DB + routes)", () => {
	const FREE_ACCOUNT = crypto.randomUUID();
	const PAID_ACCOUNT = crypto.randomUUID();
	const SUBGRAPH = "genesis-clamp-test-sg";
	const REGISTERED_START = 777_000;
	let prevMode: string | undefined;

	beforeAll(async () => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		const db = getDb();
		await db
			.insertInto("accounts")
			.values([
				{ id: FREE_ACCOUNT, email: `${FREE_ACCOUNT}@test.local`, plan: "none" },
				{ id: PAID_ACCOUNT, email: `${PAID_ACCOUNT}@test.local`, plan: "scale" },
			])
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();
		await registerSubgraph(db, {
			name: SUBGRAPH,
			version: "1.0.0",
			accountId: FREE_ACCOUNT,
			schemaName: `sg_genesis_clamp_${FREE_ACCOUNT.slice(0, 8)}`.replace(/-/g, "_"),
			definition: { name: SUBGRAPH, sources: {}, schema: {}, handlers: {} },
			schemaHash: "genesis-clamp-test-hash",
			handlerPath: "/tmp/genesis-clamp-test-handler.ts",
			startBlock: REGISTERED_START,
		});
		await cache.refresh();
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "=", SUBGRAPH)
			.execute();
		await db.deleteFrom("subgraphs").where("name", "=", SUBGRAPH).execute();
		await db
			.deleteFrom("accounts")
			.where("id", "in", [FREE_ACCOUNT, PAID_ACCOUNT])
			.execute();
		await cache.refresh();
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

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

	test("plan none → clamped; paid → allowed; exempt env → allowed", async () => {
		const db = getDb();
		expect(
			(await resolveGenesisPolicy(db, FREE_ACCOUNT)).genesisAllowed,
		).toBe(false);
		expect((await resolveGenesisPolicy(db, PAID_ACCOUNT)).genesisAllowed).toBe(
			true,
		);
		expect((await resolveGenesisPolicy(db, undefined)).genesisAllowed).toBe(
			false,
		);
		const exempt = await resolveGenesisPolicy(db, FREE_ACCOUNT, {
			...process.env,
			SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS: FREE_ACCOUNT,
		} as NodeJS.ProcessEnv);
		expect(exempt.genesisAllowed).toBe(true);
	});

	test("oss mode → always allowed", async () => {
		process.env.INSTANCE_MODE = "oss";
		try {
			const policy = await resolveGenesisPolicy(getDb(), FREE_ACCOUNT);
			expect(policy.genesisAllowed).toBe(true);
			expect(policy.reason).toBe("non-platform");
		} finally {
			process.env.INSTANCE_MODE = "platform";
		}
	});

	test("free-tier backfill → 403 GENESIS_BACKFILL_REQUIRES_PLAN", async () => {
		const res = await appAs(FREE_ACCOUNT).request(
			`/subgraphs/${SUBGRAPH}/backfill`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fromBlock: 1, toBlock: 100 }),
			},
		);
		expect(res.status).toBe(403);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.code).toBe("GENESIS_BACKFILL_REQUIRES_PLAN");
	});

	test("free-tier reindex materializes fromBlock at registered start", async () => {
		const res = await appAs(FREE_ACCOUNT).request(
			`/subgraphs/${SUBGRAPH}/reindex`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.fromBlock).toBe(REGISTERED_START);
	});

	test("free-tier reindex below registered start is floored", async () => {
		await getDb()
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "=", SUBGRAPH)
			.execute();
		const res = await appAs(FREE_ACCOUNT).request(
			`/subgraphs/${SUBGRAPH}/reindex`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fromBlock: 1 }),
			},
		);
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.fromBlock).toBe(REGISTERED_START);
	});
});
