import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { subgraphCreditsGate } from "./credits-gate.ts";

type Env = {
	Variables: {
		v1AccountId?: string;
		credited?: { accountId: string; balance: bigint };
	};
};

const HAS_DB = !!process.env.DATABASE_URL;
const savedMode = process.env.INSTANCE_MODE;

function restoreMode() {
	if (savedMode === undefined) delete process.env.INSTANCE_MODE;
	else process.env.INSTANCE_MODE = savedMode;
}

function inspectApp(accountId?: string) {
	const app = new Hono<Env>();
	app.use("*", async (c, next) => {
		if (accountId) c.set("v1AccountId", accountId);
		await next();
	});
	app.use("*", subgraphCreditsGate());
	app.get("/", (c) => {
		const credited = c.get("credited");
		return c.json({
			credited: credited
				? { accountId: credited.accountId, balance: String(credited.balance) }
				: null,
		});
	});
	return app;
}

describe("subgraphCreditsGate", () => {
	afterEach(restoreMode);

	test("no-op when v1AccountId is missing", async () => {
		process.env.INSTANCE_MODE = "platform";
		const res = await inspectApp().request("/");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ credited: null });
	});

	test("no-op in OSS even with v1AccountId", async () => {
		process.env.INSTANCE_MODE = "oss";
		const res = await inspectApp("acct_oss").request("/");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ credited: null });
	});
});

describe.skipIf(!HAS_DB)("subgraphCreditsGate (DB)", () => {
	const TEST_EMAIL = `subgraph-credits-gate-${Date.now()}@example.com`;
	let accountId: string;
	const db = HAS_DB ? getDb() : (null as never);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		const row = await db
			.insertInto("accounts")
			.values({ email: TEST_EMAIL })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = row.id;
		await creditCredits(db, accountId, 1_000_000n);
	});

	afterAll(async () => {
		restoreMode();
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
	});

	test("sets credited for a prepaid account", async () => {
		process.env.INSTANCE_MODE = "platform";
		const res = await inspectApp(accountId).request("/");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			credited: { accountId, balance: "1000000" },
		});
	});
});
