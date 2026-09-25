import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import internalAccountsCreditsRouter, {
	MAX_ACCOUNTS_CREDITS_BATCH,
} from "./internal-accounts-credits.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: false })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

let prevKey: string | undefined;

beforeEach(() => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
});

afterEach(() => {
	if (prevKey === undefined) delete process.env.WORKLOAD_HOST_KEY;
	else process.env.WORKLOAD_HOST_KEY = prevKey;
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db
			.deleteFrom("account_credits")
			.where("account_id", "in", accountIds)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/accounts/credits", internalAccountsCreditsRouter);
	return a;
}

describe.skipIf(!HAS_DB)("POST /internal/accounts/credits", () => {
	test("missing Authorization → 401", async () => {
		const res = await app().request("/internal/accounts/credits", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ account_ids: [] }),
		});
		expect(res.status).toBe(401);
	});

	test("missing account_ids → 400", async () => {
		const res = await app().request("/internal/accounts/credits", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("empty array → {}", async () => {
		const res = await app().request("/internal/accounts/credits", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_ids: [] }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
	});

	test("over the batch cap → 413", async () => {
		const ids = Array.from(
			{ length: MAX_ACCOUNTS_CREDITS_BATCH + 1 },
			(_, i) => `acct_${i}`,
		);
		const res = await app().request("/internal/accounts/credits", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_ids: ids }),
		});
		expect(res.status).toBe(413);
	});

	test("reports credits_ok per account", async () => {
		const funded = await makeAccount();
		const unfunded = await makeAccount();
		await creditCredits(db, funded, 1_000_000n);

		const res = await app().request("/internal/accounts/credits", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_ids: [funded, unfunded] }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ [funded]: true, [unfunded]: false });
	});
});

describe.skipIf(!HAS_DB)("mounted on the platform app", () => {
	let prevDevMode: string | undefined;
	beforeEach(() => {
		prevDevMode = process.env.DEV_MODE;
		process.env.DEV_MODE = "false";
	});
	afterEach(() => {
		if (prevDevMode === undefined) delete process.env.DEV_MODE;
		else process.env.DEV_MODE = prevDevMode;
	});

	test("mounted at /internal/accounts/credits", async () => {
		const api = createApiApp("platform");
		const res = await api.request("/internal/accounts/credits", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_ids: [] }),
		});
		expect(res.status).toBe(200);
	});

	test("not mounted in oss mode", async () => {
		const api = createApiApp("oss");
		const res = await api.request("/internal/accounts/credits", {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});
});
