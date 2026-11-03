import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createApiApp } from "../create-app.ts";
import { generateSessionToken, hashToken } from "./keys.ts";
import { rotateApiKey } from "./mint.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];
let prevMode: string | undefined;
let prevDev: string | undefined;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevDev = process.env.DEV_MODE;
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
});

afterAll(async () => {
	const restore = (k: string, v: string | undefined) => {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	};
	restore("INSTANCE_MODE", prevMode);
	restore("DEV_MODE", prevDev);
	if (!HAS_DB || accountIds.length === 0) return;
	await db
		.deleteFrom("sessions")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function makeSession(accountId: string): Promise<string> {
	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: accountId,
			ip_address: "test",
		})
		.execute();
	return raw;
}

async function makeKey(
	accountId: string,
	opts: {
		name?: string | null;
		product?: "account" | "docs" | "tenant" | "sentinel";
		tier?: "free" | "internal";
		status?: "active" | "revoked";
	} = {},
): Promise<{ id: string; raw: string }> {
	const raw = `sk-sl_rotate_${crypto.randomUUID()}`;
	const row = await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(raw),
			key_prefix: raw.slice(0, 14),
			account_id: accountId,
			name: opts.name === undefined ? "Production" : opts.name,
			ip_address: "test",
			product: opts.product ?? "account",
			tier: opts.tier ?? "free",
			status: opts.status ?? "active",
			revoked_at: opts.status === "revoked" ? new Date() : null,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return { id: row.id, raw };
}

async function rowById(id: string) {
	return db
		.selectFrom("api_keys")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
}

async function activeCount(accountId: string): Promise<number> {
	const rows = await db
		.selectFrom("api_keys")
		.select("id")
		.where("account_id", "=", accountId)
		.where("status", "=", "active")
		.execute();
	return rows.length;
}

const app = createApiApp("platform");

type Rotated = {
	key: string;
	prefix: string;
	id: string;
	name: string | null;
	product: string;
	tier: string | null;
	rotatedFrom: string;
};

function rotate(token: string | null, id: string, appUnderTest = app) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (token) headers.authorization = `Bearer ${token}`;
	return appUnderTest.request(`/api/keys/${id}/rotate`, {
		method: "POST",
		headers,
		body: "{}",
	});
}

function listKeys(token: string) {
	return app.request("/api/keys", {
		headers: { authorization: `Bearer ${token}` },
	});
}

describe.skipIf(!HAS_DB)("key rotation", () => {
	test("a session rotates a key into a new row with the same name", async () => {
		const accountId = await makeAccount();
		const old = await makeKey(accountId, { name: "Production" });
		const res = await rotate(await makeSession(accountId), old.id);
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as Rotated;
		expect(body.key.startsWith(body.prefix)).toBe(true);
		expect(body.key).not.toBe(old.raw);
		expect(body.name).toBe("Production");
		expect(body.product).toBe("account");
		expect(body.rotatedFrom).toBe(old.id);
		expect(body.id).not.toBe(old.id);
		const oldRow = await rowById(old.id);
		expect(oldRow.status).toBe("revoked");
		expect(oldRow.revoked_at).not.toBeNull();
	});

	test("the old secret reads as revoked and the new secret works", async () => {
		const accountId = await makeAccount();
		const old = await makeKey(accountId);
		const res = await rotate(await makeSession(accountId), old.id);
		const body = (await res.json()) as Rotated;
		const oldRes = await listKeys(old.raw);
		expect(oldRes.status).toBe(401);
		expect(((await oldRes.json()) as { code: string }).code).toBe(
			"KEY_REVOKED",
		);
		expect((await listKeys(body.key)).status).toBe(200);
	});

	test("an account key rotates itself and another key on its account", async () => {
		const accountId = await makeAccount();
		const caller = await makeKey(accountId, { name: "Caller" });
		const other = await makeKey(accountId, { name: "Other" });
		const otherRes = await rotate(caller.raw, other.id);
		expect(otherRes.status).toBe(201);
		const selfRes = await rotate(caller.raw, caller.id);
		expect(selfRes.status).toBe(201);
		expect((await rowById(caller.id)).status).toBe("revoked");
		expect((await rowById(other.id)).status).toBe("revoked");
	});

	test("the internal tier carries over and a free key stays free", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		const internal = await makeKey(accountId, { tier: "internal" });
		const free = await makeKey(accountId, { tier: "free" });
		const internalBody = (await (
			await rotate(session, internal.id)
		).json()) as Rotated;
		const freeBody = (await (await rotate(session, free.id)).json()) as Rotated;
		expect((await rowById(internalBody.id)).tier).toBe("internal");
		expect((await rowById(freeBody.id)).tier).toBe("free");
	});

	test("rotating a key at the active-key ceiling succeeds and keeps the count", async () => {
		const accountId = await makeAccount();
		const first = await makeKey(accountId);
		for (let i = 1; i < 50; i++) await makeKey(accountId);
		expect(await activeCount(accountId)).toBe(50);
		const res = await rotate(await makeSession(accountId), first.id);
		expect(res.status).toBe(201);
		expect(await activeCount(accountId)).toBe(50);
	});

	test("two concurrent rotates of one key mint exactly one replacement", async () => {
		const accountId = await makeAccount();
		const old = await makeKey(accountId);
		const session = await makeSession(accountId);
		const results = await Promise.all([
			rotate(session, old.id),
			rotate(session, old.id),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
		expect(await activeCount(accountId)).toBe(1);
		const all = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", accountId)
			.execute();
		expect(all).toHaveLength(2);
	});

	test("a mint failure rolls back and leaves the old key active", async () => {
		const accountId = await makeAccount();
		const old = await makeKey(accountId);
		await expect(
			rotateApiKey(db, { accountId, id: old.id, ip: "test" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const row = await rowById(old.id);
		expect(row.status).toBe("active");
		expect(row.revoked_at).toBeNull();
		const all = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", accountId)
			.execute();
		expect(all).toHaveLength(1);
	});

	test("at the rate limit the route answers 429 and the old key keeps working", async () => {
		const accountId = await makeAccount();
		const old = await makeKey(accountId);
		const session = await makeSession(accountId);
		for (let i = 0; i < 20; i++) {
			await getRateLimitStore().check(
				`key-create:${accountId}`,
				20,
				60 * 60 * 1000,
				{ failClosed: true },
			);
		}
		const res = await rotate(session, old.id);
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).not.toBeNull();
		expect((await rowById(old.id)).status).toBe("active");
	});

	test("another account's key answers 403 and stays active", async () => {
		const mine = await makeAccount();
		const theirs = await makeAccount();
		const target = await makeKey(theirs);
		const res = await rotate(await makeSession(mine), target.id);
		expect(res.status).toBe(403);
		expect((await rowById(target.id)).status).toBe("active");
		expect(await activeCount(theirs)).toBe(1);
	});

	test("an unknown or malformed id answers 404", async () => {
		const session = await makeSession(await makeAccount());
		expect((await rotate(session, crypto.randomUUID())).status).toBe(404);
		expect((await rotate(session, "not-a-uuid")).status).toBe(404);
	});

	test("a revoked key answers 409", async () => {
		const accountId = await makeAccount();
		const revoked = await makeKey(accountId, { status: "revoked" });
		const res = await rotate(await makeSession(accountId), revoked.id);
		expect(res.status).toBe(409);
		expect(await activeCount(accountId)).toBe(0);
	});

	for (const product of ["docs", "tenant", "sentinel"] as const) {
		test(`a ${product} key cannot be rotated and stays active`, async () => {
			const accountId = await makeAccount();
			const target = await makeKey(accountId, { product });
			const res = await rotate(await makeSession(accountId), target.id);
			expect(res.status).toBe(409);
			expect((await rowById(target.id)).status).toBe("active");
			expect(await activeCount(accountId)).toBe(1);
		});
	}

	test("an unauthenticated request answers 401", async () => {
		const res = await rotate(null, crypto.randomUUID());
		expect(res.status).toBe(401);
	});

	test("the oss app does not serve the route", async () => {
		const res = await rotate(null, crypto.randomUUID(), createApiApp("oss"));
		expect(res.status).toBe(404);
	});
});
