import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import internalTenantKeyRouter, {
	HOSTED_STACK_KEY_NAME,
} from "./internal-tenant-key.ts";

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
			.deleteFrom("api_keys")
			.where("account_id", "in", accountIds)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/keys/tenant", internalTenantKeyRouter);
	return a;
}

describe.skipIf(!HAS_DB)("POST /internal/keys/tenant", () => {
	test("missing Authorization → 401", async () => {
		const res = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ account_id: "whatever" }),
		});
		expect(res.status).toBe(401);
	});

	test("wrong workload host key → 401", async () => {
		const res = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer nope",
			},
			body: JSON.stringify({ account_id: "whatever" }),
		});
		expect(res.status).toBe(401);
	});

	test("missing account_id → 400", async () => {
		const res = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("mints a working hosted-stack key", async () => {
		const accountId = await makeAccount();
		const res = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_id: accountId }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { key: string };
		expect(body.key).toMatch(/^sk-sl_/);

		const row = await db
			.selectFrom("api_keys")
			.select(["name", "status", "account_id", "tier"])
			.where("account_id", "=", accountId)
			.where("status", "=", "active")
			.executeTakeFirst();
		expect(row?.name).toBe(HOSTED_STACK_KEY_NAME);
		// The evaluator's reads are first-party: never metered to the account.
		expect(row?.tier).toBe("internal");
	});

	test("a second call revokes the first hosted-stack key (rotating, idempotent)", async () => {
		const accountId = await makeAccount();
		const first = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_id: accountId }),
		});
		const firstBody = (await first.json()) as { key: string };

		const second = await app().request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ account_id: accountId }),
		});
		const secondBody = (await second.json()) as { key: string };
		expect(secondBody.key).not.toBe(firstBody.key);

		const active = await db
			.selectFrom("api_keys")
			.select(["key_hash"])
			.where("account_id", "=", accountId)
			.where("name", "=", HOSTED_STACK_KEY_NAME)
			.where("status", "=", "active")
			.execute();
		expect(active).toHaveLength(1); // only the second key is active
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

	test("mounted at /internal/keys/tenant", async () => {
		const api = createApiApp("platform");
		const res = await api.request("/internal/keys/tenant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400); // reaches the route's own guard
	});

	test("not mounted in oss mode", async () => {
		const api = createApiApp("oss");
		const res = await api.request("/internal/keys/tenant", { method: "POST" });
		expect(res.status).toBe(404);
	});
});
