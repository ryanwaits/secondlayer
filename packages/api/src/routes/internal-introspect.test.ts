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
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import internalIntrospectRouter from "./internal-introspect.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];

async function makeAccount(opts?: { ghost?: boolean }): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: opts?.ghost ?? false })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function makeApiKey(
	accountId: string,
	opts?: { status?: "active" | "revoked" },
): Promise<string> {
	const raw = `sk-sl_introspect_test_${crypto.randomUUID()}`;
	await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(raw),
			key_prefix: raw.slice(0, 14),
			account_id: accountId,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: opts?.status ?? "active",
		})
		.execute();
	return raw;
}

async function makeSession(
	accountId: string,
	opts?: { revoked?: boolean; expiresAt?: Date },
): Promise<string> {
	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: accountId,
			ip_address: "test",
			...(opts?.expiresAt ? { expires_at: opts.expiresAt } : {}),
			...(opts?.revoked ? { revoked_at: new Date() } : {}),
		})
		.execute();
	return raw;
}

let prevKey: string | undefined;

beforeEach(() => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
});

afterEach(async () => {
	if (prevKey === undefined) delete process.env.WORKLOAD_HOST_KEY;
	else process.env.WORKLOAD_HOST_KEY = prevKey;
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db
			.deleteFrom("sessions")
			.where("account_id", "in", accountIds)
			.execute();
		await db
			.deleteFrom("api_keys")
			.where("account_id", "in", accountIds)
			.execute();
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
	a.route("/internal/keys/introspect", internalIntrospectRouter);
	return a;
}

describe.skipIf(!HAS_DB)("POST /internal/keys/introspect", () => {
	test("missing Authorization → 401", async () => {
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ key: "sk-sl_whatever" }),
		});
		expect(res.status).toBe(401);
	});

	test("wrong workload host key → 401", async () => {
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer nope",
			},
			body: JSON.stringify({ key: "sk-sl_whatever" }),
		});
		expect(res.status).toBe(401);
	});

	test("when WORKLOAD_HOST_KEY is unset, every request 401s", async () => {
		delete process.env.WORKLOAD_HOST_KEY;
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: "sk-sl_whatever" }),
		});
		expect(res.status).toBe(401);
	});

	test("body without a sk-sl_ or ss-sl_ credential → 400", async () => {
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: "not-a-key" }),
		});
		expect(res.status).toBe(400);
	});

	test("unknown key → 401 invalid_key", async () => {
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: "sk-sl_does_not_exist" }),
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
	});

	test("revoked key → 401 invalid_key", async () => {
		const accountId = await makeAccount();
		const raw = await makeApiKey(accountId, { status: "revoked" });
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(401);
	});

	test("ghost account key → 401 invalid_key (D4: no anonymous path)", async () => {
		const accountId = await makeAccount({ ghost: true });
		const raw = await makeApiKey(accountId);
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(401);
	});

	test("active key with zero balance → credits_ok: false", async () => {
		const accountId = await makeAccount();
		const raw = await makeApiKey(accountId);
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			account_id: accountId,
			credits_ok: false,
		});
	});

	test("active key with a prepaid balance → credits_ok: true", async () => {
		const accountId = await makeAccount();
		const raw = await makeApiKey(accountId);
		await creditCredits(db, accountId, 1_000_000n);
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			account_id: accountId,
			credits_ok: true,
		});
	});

	test("a revoked key stops introspecting immediately (no cache on this side)", async () => {
		const accountId = await makeAccount();
		const raw = await makeApiKey(accountId);
		const ok = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(ok.status).toBe(200);

		await db
			.updateTable("api_keys")
			.set({ status: "revoked" })
			.where("key_hash", "=", hashToken(raw))
			.execute();

		const revoked = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(revoked.status).toBe(401);
	});

	test("valid dashboard session → account_id + credits_ok", async () => {
		const accountId = await makeAccount();
		const raw = await makeSession(accountId);
		await creditCredits(db, accountId, 1_000_000n);
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			account_id: accountId,
			credits_ok: true,
		});
	});

	test("expired session → 401 invalid_key", async () => {
		const accountId = await makeAccount();
		const raw = await makeSession(accountId, {
			expiresAt: new Date(Date.now() - 1000),
		});
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
	});

	test("revoked session → 401 invalid_key", async () => {
		const accountId = await makeAccount();
		const raw = await makeSession(accountId, { revoked: true });
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
	});

	test("unknown session → 401 invalid_key", async () => {
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: "ss-sl_does_not_exist" }),
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
	});

	test("ghost account's session → 401 invalid_key (no anonymous path)", async () => {
		const accountId = await makeAccount({ ghost: true });
		const raw = await makeSession(accountId);
		const res = await app().request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: raw }),
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
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

	test("mounted at /internal/keys/introspect, not gated by account resourceAuth", async () => {
		const api = createApiApp("platform");
		const res = await api.request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ key: "sk-sl_does_not_exist" }),
		});
		// Reaches the route's own guard (401 invalid_key), not the
		// session-auth 401 the ACCOUNT_PATHS middleware would give for a
		// missing session — both are 401 here, so assert the route ran by
		// checking the body shape instead of the status code alone.
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "invalid_key" });
	});

	test("not mounted in oss mode", async () => {
		const api = createApiApp("oss");
		const res = await api.request("/internal/keys/introspect", {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});
});
