import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	type SentinelAreas,
	createInternalSentinelRouter,
	parseAreas,
	sentinelServiceKeyMatches,
} from "./internal-sentinel.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const KEY = "test-sentinel-key";
const accountIds: string[] = [];
const emails: string[] = [];

/** A pre-existing account; linked to Sentinel unless `linked` is false. */
async function makeAccount(
	email: string | null = null,
	linked = true,
): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email, ghost: email === null })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	if (linked) {
		await db
			.insertInto("sentinel_accounts")
			.values({ account_id: row.id, via: "consent" })
			.execute();
	}
	return row.id;
}

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/sentinel", createInternalSentinelRouter());
	return a;
}

function post(a: Hono, path: string, body: unknown, key: string | null = KEY) {
	return a.request(`/internal/sentinel${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

let prevSentinel: string | undefined;
let prevWorkload: string | undefined;

beforeEach(() => {
	prevSentinel = process.env.SENTINEL_SERVICE_KEY;
	prevWorkload = process.env.WORKLOAD_HOST_KEY;
	process.env.SENTINEL_SERVICE_KEY = KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
});

afterEach(() => {
	for (const [k, v] of [
		["SENTINEL_SERVICE_KEY", prevSentinel],
		["WORKLOAD_HOST_KEY", prevWorkload],
	] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

afterAll(async () => {
	if (!HAS_DB) return;
	const ids = [...accountIds];
	if (emails.length > 0) {
		const rows = await db
			.selectFrom("accounts")
			.select("id")
			.where("email", "in", emails)
			.execute();
		ids.push(...rows.map((r) => r.id));
	}
	if (ids.length === 0) return;
	await db.deleteFrom("api_keys").where("account_id", "in", ids).execute();
	await db.deleteFrom("sessions").where("account_id", "in", ids).execute();
	await db.deleteFrom("usage_ledger").where("account_id", "in", ids).execute();
	await db
		.deleteFrom("account_spend_caps")
		.where("account_id", "in", ids)
		.execute();
	await db
		.deleteFrom("account_credits")
		.where("account_id", "in", ids)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", ids).execute();
});

describe("/internal/sentinel auth", () => {
	const routes: [string, unknown][] = [
		["/accounts/resolve", { email: "a@b.co" }],
		["/accounts/link", {}],
		["/tokens/resolve", {}],
		["/keys", {}],
	];

	test.each(routes)("%s: missing key → 401", async (path, body) => {
		expect((await post(app(), path, body, null)).status).toBe(401);
	});

	test.each(routes)("%s: wrong key → 401", async (path, body) => {
		expect((await post(app(), path, body, "nope")).status).toBe(401);
	});

	test.each(routes)("%s: workload host key → 401", async (path, body) => {
		expect(
			(await post(app(), path, body, "test-workload-host-key")).status,
		).toBe(401);
	});

	test.each(routes)(
		"%s: unset SENTINEL_SERVICE_KEY → 401",
		async (path, body) => {
			delete process.env.SENTINEL_SERVICE_KEY;
			expect((await post(app(), path, body, KEY)).status).toBe(401);
		},
	);

	test("the workload host key can't stand in even if configured identically", async () => {
		process.env.SENTINEL_SERVICE_KEY = "shared";
		process.env.WORKLOAD_HOST_KEY = "shared";
		expect(
			(await post(app(), "/accounts/resolve", { email: "a@b.co" }, "shared"))
				.status,
		).toBe(401);
	});
});

describe.skipIf(!HAS_DB)("/internal/sentinel routes", () => {
	test("mounted in platform mode with the Sentinel key, not in oss mode", async () => {
		const body = JSON.stringify({ email: `mount-${randomUUID()}@example.com` });
		emails.push(JSON.parse(body).email);
		const headers = {
			"content-type": "application/json",
			authorization: `Bearer ${KEY}`,
		};
		const res = await createApiApp("platform").request(
			"/internal/sentinel/accounts/resolve",
			{ method: "POST", headers, body },
		);
		expect(res.status).toBe(200);
		const oss = await createApiApp("oss").request(
			"/internal/sentinel/accounts/resolve",
			{ method: "POST", headers, body },
		);
		expect(oss.status).toBe(404);
	});

	test("resolve lowercases + trims, is idempotent, hadAccount is correct", async () => {
		const email = `Sentinel-${randomUUID()}@Example.COM`;
		const lower = email.toLowerCase();
		emails.push(lower);

		const first = await post(app(), "/accounts/resolve", {
			email: `  ${email}  `,
		});
		expect(first.status).toBe(200);
		const a = (await first.json()) as {
			accountId: string;
			created: boolean;
			hadAccount: boolean;
			linked: boolean;
		};
		expect(a.created).toBe(true);
		expect(a.hadAccount).toBe(false);
		expect((a as { linked?: boolean }).linked).toBe(true);
		const linkRow = await db
			.selectFrom("sentinel_accounts")
			.select("via")
			.where("account_id", "=", a.accountId)
			.executeTakeFirstOrThrow();
		expect(linkRow.via).toBe("created");

		const stored = await db
			.selectFrom("accounts")
			.select("email")
			.where("id", "=", a.accountId)
			.executeTakeFirstOrThrow();
		expect(stored.email).toBe(lower);

		const second = await post(app(), "/accounts/resolve", { email: lower });
		const b = (await second.json()) as typeof a;
		expect(b).toEqual({
			accountId: a.accountId,
			created: false,
			hadAccount: true,
			linked: true,
		});
	});

	test("resolve finds a pre-existing account stored with mixed case", async () => {
		const mixed = `Legacy-${randomUUID()}@Example.com`;
		const id = await makeAccount(mixed, false);
		const res = await post(app(), "/accounts/resolve", { email: mixed });
		expect(await res.json()).toEqual({
			accountId: id,
			created: false,
			hadAccount: true,
			linked: false,
		});
		// Resolving an existing account must not link it.
		const rows = await db
			.selectFrom("sentinel_accounts")
			.select("account_id")
			.where("account_id", "=", id)
			.execute();
		expect(rows).toHaveLength(0);
	});

	test("resolve rejects a bad email", async () => {
		expect(
			(await post(app(), "/accounts/resolve", { email: "nope" })).status,
		).toBe(400);
		expect((await post(app(), "/accounts/resolve", {})).status).toBe(400);
	});

	test("link: consent links an existing account, idempotent, 404 unknown", async () => {
		const id = await makeAccount(`link-${randomUUID()}@example.com`, false);
		for (let i = 0; i < 2; i++) {
			const res = await post(app(), "/accounts/link", { accountId: id });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ linked: true });
		}
		const rows = await db
			.selectFrom("sentinel_accounts")
			.select("via")
			.where("account_id", "=", id)
			.execute();
		expect(rows).toEqual([{ via: "consent" }]);
		expect(
			(await post(app(), "/accounts/link", { accountId: randomUUID() })).status,
		).toBe(404);
		expect(
			(await post(app(), "/accounts/link", { accountId: "nope" })).status,
		).toBe(404);
	});

	test("unlinked account: mint and list keys → 403 account_not_linked", async () => {
		const id = await makeAccount(`unl-${randomUUID()}@example.com`, false);
		const mint = await post(app(), "/keys", {
			accountId: id,
			name: "agent",
			areas: { plans: "read", monitoring: "read", alerts: "none" },
		});
		expect(mint.status).toBe(403);
		expect(await mint.json()).toMatchObject({ error: "account_not_linked" });
		const list = await app().request(
			`/internal/sentinel/keys?accountId=${id}`,
			{
				headers: { authorization: `Bearer ${KEY}` },
			},
		);
		expect(list.status).toBe(403);
	});

	test.each([
		"/accounts/grant",
		"/accounts/summary",
		"/accounts/settle",
		"/settings",
		"/affordable",
		"/checkout",
	])("%s: money routes are gone → 404", async (path) => {
		const res = await post(app(), path, { accountId: randomUUID() });
		expect(res.status).toBe(404);
	});
});

describe("parseAreas", () => {
	const ok: SentinelAreas = {
		plans: "write",
		monitoring: "read",
		alerts: "none",
	};
	test("accepts exactly the three areas", () => {
		expect(parseAreas(ok)).toEqual(ok);
	});
	test.each([
		["not an object", "read"],
		["array", []],
		["missing area", { plans: "read", monitoring: "read" }],
		["unknown area", { ...ok, billing: "read" }],
		["unknown level", { ...ok, plans: "admin" }],
	])("rejects %s", (_n, v) => {
		expect(() => parseAreas(v)).toThrow();
	});
});

describe.skipIf(!HAS_DB)("/internal/sentinel tokens + keys", () => {
	const areas = { plans: "write", monitoring: "read", alerts: "none" };
	const get = (path: string, key: string | null = KEY) =>
		app().request(`/internal/sentinel${path}`, {
			headers: key ? { authorization: `Bearer ${key}` } : {},
		});
	const del = (path: string) =>
		app().request(`/internal/sentinel${path}`, {
			method: "DELETE",
			headers: { authorization: `Bearer ${KEY}` },
		});
	const mint = async (accountId: string, name = "agent") =>
		(await (await post(app(), "/keys", { accountId, name, areas })).json()) as {
			id: string;
			key: string;
			prefix: string;
		};
	const resolve = (raw: string) =>
		post(app(), "/tokens/resolve", { tokenHash: hashToken(raw) });
	async function makeSession(
		accountId: string,
		opts: { revoked?: boolean; expiresAt?: Date } = {},
	) {
		const { raw, hash, prefix } = generateSessionToken();
		await db
			.insertInto("sessions")
			.values({
				token_hash: hash,
				token_prefix: prefix,
				account_id: accountId,
				ip_address: "test",
				...(opts.expiresAt ? { expires_at: opts.expiresAt } : {}),
				...(opts.revoked ? { revoked_at: new Date() } : {}),
			})
			.execute();
		return raw;
	}

	test("mint returns the raw key once; the stored row holds only the hash", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const res = await post(app(), "/keys", { accountId, name: "ci", areas });
		expect(res.status).toBe(201);
		const body = (await res.json()) as Record<string, unknown>;
		expect(String(body.key)).toMatch(/^sk-snt_[0-9a-f]{32}$/);
		expect(String(body.prefix)).toMatch(/^sk-snt_[0-9a-f]{8}$/);
		expect(body.areas).toEqual(areas);
		const row = await db
			.selectFrom("api_keys")
			.selectAll()
			.where("id", "=", String(body.id))
			.executeTakeFirstOrThrow();
		expect(row.key_hash).toBe(hashToken(String(body.key)));
		expect(row.key_prefix).toBe(String(body.prefix));
		expect(row.product).toBe("sentinel");
		expect(row.areas).toEqual(areas);
	});

	test("mint validates areas, name and the linked account", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		for (const bad of [
			undefined,
			{ plans: "write" },
			{ ...areas, extra: "read" },
			{ ...areas, plans: "owner" },
		]) {
			expect(
				(await post(app(), "/keys", { accountId, name: "x", areas: bad }))
					.status,
			).toBe(400);
		}
		expect((await post(app(), "/keys", { accountId, areas })).status).toBe(400);
		const unlinked = await makeAccount(`k-${randomUUID()}@example.com`, false);
		expect(
			(await post(app(), "/keys", { accountId: unlinked, name: "x", areas }))
				.status,
		).toBe(403);
	});

	test("list is scoped to the account and never returns raw key or hash", async () => {
		const a = await makeAccount(`k-${randomUUID()}@example.com`);
		const b = await makeAccount(`k-${randomUUID()}@example.com`);
		const ka = await mint(a, "mine");
		await mint(b, "theirs");
		const res = await get(`/keys?accountId=${a}`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain(ka.key);
		expect(text).not.toContain("key_hash");
		const { keys } = JSON.parse(text) as {
			keys: { id: string; name: string; prefix: string; areas: unknown }[];
		};
		expect(keys.map((k) => k.name)).toEqual(["mine"]);
		expect(keys[0]?.prefix).toBe(ka.prefix);
		expect(keys[0]?.areas).toEqual(areas);
	});

	test("delete revokes within the account only", async () => {
		const a = await makeAccount(`k-${randomUUID()}@example.com`);
		const b = await makeAccount(`k-${randomUUID()}@example.com`);
		const ka = await mint(a);
		expect((await del(`/keys/${ka.id}?accountId=${b}`)).status).toBe(404);
		expect((await resolve(ka.key)).status).toBe(200);
		expect((await del(`/keys/${ka.id}?accountId=${a}`)).status).toBe(200);
		expect((await resolve(ka.key)).status).toBe(404);
		expect((await del(`/keys/${ka.id}?accountId=${a}`)).status).toBe(404);
		expect((await del(`/keys/not-a-uuid?accountId=${a}`)).status).toBe(404);
	});

	test("resolve: sentinel key → kind key with areas, no identity; session → kind session with email and linked", async () => {
		const email = `k-${randomUUID()}@example.com`;
		const accountId = await makeAccount(email);
		const k = await mint(accountId);
		const res = await resolve(k.key);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			accountId,
			kind: "key",
			keyId: k.id,
			areas,
		});
		const session = await makeSession(accountId);
		const sres = await resolve(session);
		expect(sres.status).toBe(200);
		expect(await sres.json()).toEqual({
			accountId,
			kind: "session",
			email,
			linked: true,
		});
	});

	test("resolve: a session's email comes back lowercased", async () => {
		const id = randomUUID();
		const accountId = await makeAccount(`MiXeD-${id}@Example.COM`);
		const body = (await (
			await resolve(await makeSession(accountId))
		).json()) as Record<string, unknown>;
		expect(body.email).toBe(`mixed-${id}@example.com`);
	});

	test("resolve: an unlinked account's session says linked false", async () => {
		const email = `k-${randomUUID()}@example.com`;
		const accountId = await makeAccount(email, false);
		const res = await resolve(await makeSession(accountId));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			accountId,
			kind: "session",
			email,
			linked: false,
		});
	});

	test("resolve: a session of an account with no email omits email", async () => {
		const accountId = await makeAccount(null);
		const body = (await (
			await resolve(await makeSession(accountId))
		).json()) as Record<string, unknown>;
		expect(body).toEqual({ accountId, kind: "session", linked: true });
		expect("email" in body).toBe(false);
	});

	test("resolve: expired and revoked sessions, unknown hashes → 404", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const expired = await makeSession(accountId, {
			expiresAt: new Date(Date.now() - 1000),
		});
		const revoked = await makeSession(accountId, { revoked: true });
		expect((await resolve(expired)).status).toBe(404);
		expect((await resolve(revoked)).status).toBe(404);
		expect((await resolve(`sk-sl_${randomUUID()}`)).status).toBe(404);
	});

	async function insertKey(
		accountId: string,
		raw: string,
		product: "account" | "sentinel",
		status: "active" | "revoked" = "active",
	) {
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(raw),
				key_prefix: raw.slice(0, 14),
				account_id: accountId,
				ip_address: "test",
				product,
				status,
				tier: "free",
				...(product === "sentinel" ? { areas } : {}),
			})
			.execute();
	}

	test("resolve: an active account key → 404 other_product, never resolved", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const raw = `sk-sl_acct_${randomUUID()}`;
		await insertKey(accountId, raw, "account");
		const res = await resolve(raw);
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "other_product" });
		expect(body.accountId).toBeUndefined();
	});

	test("resolve: revoked keys of any product → plain 404", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		for (const product of ["account", "sentinel"] as const) {
			const raw = `sk-sl_rev_${randomUUID()}`;
			await insertKey(accountId, raw, product, "revoked");
			const res = await resolve(raw);
			expect(res.status).toBe(404);
			expect(((await res.json()) as { error?: string }).error).not.toBe(
				"other_product",
			);
		}
	});

	test("resolve: an existing sk-sl_ sentinel key still resolves", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const raw = `sk-sl_${randomUUID().replace(/-/g, "")}`;
		await insertKey(accountId, raw, "sentinel");
		const res = await resolve(raw);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ accountId, kind: "key", areas });
	});

	test("resolve rejects a non-hash (raw token) body", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const k = await mint(accountId);
		expect(
			(await post(app(), "/tokens/resolve", { tokenHash: k.key })).status,
		).toBe(400);
	});

	test("GET/DELETE keys require the service key", async () => {
		expect((await get("/keys?accountId=x", null)).status).toBe(401);
		expect((await get("/keys?accountId=x", "nope")).status).toBe(401);
	});
});

describe("sentinelServiceKeyMatches", () => {
	test("unset key authenticates nobody", () => {
		expect(sentinelServiceKeyMatches("anything", {})).toBe(false);
	});

	test("wrong and right keys", () => {
		expect(
			sentinelServiceKeyMatches("wrong", { SENTINEL_SERVICE_KEY: "right" }),
		).toBe(false);
		expect(
			sentinelServiceKeyMatches("right", { SENTINEL_SERVICE_KEY: "right" }),
		).toBe(true);
	});

	test("never matches when it equals the workload host key", () => {
		expect(
			sentinelServiceKeyMatches("same", {
				SENTINEL_SERVICE_KEY: "same",
				WORKLOAD_HOST_KEY: "same",
			}),
		).toBe(false);
	});
});
