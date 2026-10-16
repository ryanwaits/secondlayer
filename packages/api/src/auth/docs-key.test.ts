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
import { getRateLimitStore } from "./rate-limit-store.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];
let prevMode: string | undefined;
let prevDev: string | undefined;
let prevHost: string | undefined;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevDev = process.env.DEV_MODE;
	prevHost = process.env.WORKLOAD_HOST_KEY;
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
	process.env.WORKLOAD_HOST_KEY = "docs-key-test-host-key";
});

afterAll(async () => {
	const restore = (k: string, v: string | undefined) => {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	};
	restore("INSTANCE_MODE", prevMode);
	restore("DEV_MODE", prevDev);
	restore("WORKLOAD_HOST_KEY", prevHost);
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

async function makeAccountKey(accountId: string): Promise<string> {
	const raw = `sk-sl_docskey_account_${crypto.randomUUID()}`;
	await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(raw),
			key_prefix: raw.slice(0, 14),
			account_id: accountId,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: "active",
		})
		.execute();
	return raw;
}

const app = createApiApp("platform");

function mint(token: string) {
	return app.request("/api/keys/docs", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: "{}",
	});
}

async function mintDocs(accountId: string): Promise<string> {
	const session = await makeSession(accountId);
	const res = await mint(session);
	expect(res.status).toBe(201);
	return ((await res.json()) as { key: string }).key;
}

describe.skipIf(!HAS_DB)("docs key minting", () => {
	test("a session mints a docs key that expires in 24 hours and is never cached", async () => {
		const accountId = await makeAccount();
		const res = await mint(await makeSession(accountId));
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as {
			key: string;
			prefix: string;
			expiresAt: string;
		};
		expect(body.key.startsWith("sk-sl_")).toBe(true);
		expect(body.key.startsWith(body.prefix)).toBe(true);
		const hours = (Date.parse(body.expiresAt) - Date.now()) / 3_600_000;
		expect(hours).toBeGreaterThan(23.9);
		expect(hours).toBeLessThanOrEqual(24);

		const row = await db
			.selectFrom("api_keys")
			.selectAll()
			.where("key_hash", "=", hashToken(body.key))
			.executeTakeFirstOrThrow();
		expect(row.product).toBe("docs");
		expect(row.name).toBe("Docs key");
		expect(row.key_hash).not.toBe(body.key);
	});

	test("an api key cannot mint a docs key", async () => {
		const accountId = await makeAccount();
		const res = await mint(await makeAccountKey(accountId));
		expect(res.status).toBe(403);
		const docs = await mintDocs(accountId);
		expect((await mint(docs)).status).toBe(403);
	});

	test("minting without credentials is rejected", async () => {
		const res = await app.request("/api/keys/docs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(401);
	});

	test("minting again revokes the previous docs key", async () => {
		const accountId = await makeAccount();
		const first = await mintDocs(accountId);
		const second = await mintDocs(accountId);
		const rows = await db
			.selectFrom("api_keys")
			.select(["key_hash", "status"])
			.where("account_id", "=", accountId)
			.where("product", "=", "docs")
			.execute();
		const status = (raw: string) =>
			rows.find((r) => r.key_hash === hashToken(raw))?.status;
		expect(status(first)).toBe("revoked");
		expect(status(second)).toBe("active");
	});

	test("the eleventh docs key in a day is rate limited", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		for (let i = 0; i < 10; i++) expect((await mint(session)).status).toBe(201);
		const res = await mint(session);
		expect(res.status).toBe(429);
	});

	test("docs keys do not count toward the active key ceiling", async () => {
		const accountId = await makeAccount();
		await mintDocs(accountId);
		const { assertUnderKeyCeiling } = await import("./mint.ts");
		await expect(assertUnderKeyCeiling(db, accountId)).resolves.toBeUndefined();
		const active = await db
			.selectFrom("api_keys")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.where("account_id", "=", accountId)
			.where("status", "=", "active")
			.where("product", "!=", "docs")
			.executeTakeFirstOrThrow();
		expect(Number(active.n)).toBe(0);
	});
});

describe.skipIf(!HAS_DB)("docs key authority", () => {
	const denied: Array<[string, string, string?]> = [
		["GET", "/api/keys"],
		["POST", "/api/keys"],
		["POST", "/api/keys/docs"],
		["DELETE", "/api/keys/00000000-0000-0000-0000-000000000000"],
		["GET", "/api/accounts/me"],
		["GET", "/api/billing/status"],
		["POST", "/api/billing/topup"],
		["GET", "/api/billing/usage"],
		["POST", "/api/archive/fetch"],
		["POST", "/api/archive/quote"],
		["POST", "/v1/feedback"],
		["GET", "/status"],
	];

	for (const [method, path] of denied) {
		test(`a docs key cannot reach ${method} ${path}`, async () => {
			const accountId = await makeAccount();
			const docs = await mintDocs(accountId);
			const res = await app.request(path, {
				method,
				headers: {
					authorization: `Bearer ${docs}`,
					"content-type": "application/json",
				},
				body: method === "GET" || method === "DELETE" ? undefined : "{}",
			});
			expect(res.status).toBe(403);
		});
	}

	test("a docs key cannot mint keys", async () => {
		const accountId = await makeAccount();
		const docs = await mintDocs(accountId);
		const res = await app.request("/api/keys", {
			method: "POST",
			headers: {
				authorization: `Bearer ${docs}`,
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect(res.status).toBe(403);
		const keys = await db
			.selectFrom("api_keys")
			.select("product")
			.where("account_id", "=", accountId)
			.execute();
		expect(keys.map((k) => k.product)).toEqual(["docs"]);
	});

	test("a docs key does not introspect as an account key", async () => {
		const accountId = await makeAccount();
		const docs = await mintDocs(accountId);
		const res = await app.request("/internal/keys/introspect", {
			method: "POST",
			headers: {
				authorization: "Bearer docs-key-test-host-key",
				"content-type": "application/json",
			},
			body: JSON.stringify({ key: docs }),
		});
		expect(res.status).toBe(401);
	});

	test("a docs key reads Streams and Index", async () => {
		const accountId = await makeAccount();
		const docs = await mintDocs(accountId);
		for (const path of ["/v1/streams/tip", "/v1/index/blocks"]) {
			const res = await app.request(path, {
				headers: { authorization: `Bearer ${docs}` },
			});
			// Auth passed: whatever the handler does next (200, 402 credits,
			// empty-db 5xx), it is not an auth refusal.
			expect([401, 403]).not.toContain(res.status);
		}
	});

	test("an unknown key is refused on Streams and Index", async () => {
		for (const path of ["/v1/streams/tip", "/v1/index/blocks"]) {
			const res = await app.request(path, {
				headers: { authorization: "Bearer sk-sl_not_a_real_key" },
			});
			expect(res.status).toBe(401);
		}
	});

	test("an expired docs key is rejected on Streams and Index", async () => {
		const accountId = await makeAccount();
		const docs = await mintDocs(accountId);
		await db
			.updateTable("api_keys")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("key_hash", "=", hashToken(docs))
			.execute();
		for (const path of ["/v1/streams/tip", "/v1/index/blocks"]) {
			const res = await app.request(path, {
				headers: { authorization: `Bearer ${docs}` },
			});
			expect(res.status).toBe(401);
		}
	});

	test("an expired docs key is rejected on the management plane", async () => {
		const accountId = await makeAccount();
		const docs = await mintDocs(accountId);
		await db
			.updateTable("api_keys")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("key_hash", "=", hashToken(docs))
			.execute();
		const res = await app.request("/api/keys", {
			headers: { authorization: `Bearer ${docs}` },
		});
		expect(res.status).toBe(403);
	});

	test("a revoked docs key is rejected on Streams and Index", async () => {
		const accountId = await makeAccount();
		const first = await mintDocs(accountId);
		await mintDocs(accountId);
		for (const path of ["/v1/streams/tip", "/v1/index/blocks"]) {
			const res = await app.request(path, {
				headers: { authorization: `Bearer ${first}` },
			});
			expect(res.status).toBe(401);
		}
	});

	test("the keys list shows a live docs key with its expiry and hides an expired one", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		const docs = await mintDocs(accountId);
		const list = async () =>
			(
				(await (
					await app.request("/api/keys", {
						headers: { authorization: `Bearer ${session}` },
					})
				).json()) as {
					keys: Array<{ product: string; expiresAt: string | null }>;
				}
			).keys;
		const live = (await list()).find((k) => k.product === "docs");
		expect(live?.expiresAt).toBeTruthy();
		await db
			.updateTable("api_keys")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("key_hash", "=", hashToken(docs))
			.execute();
		expect((await list()).some((k) => k.product === "docs")).toBe(false);
	});
});

function createKey(token: string) {
	return app.request("/api/keys", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ name: "laptop" }),
	});
}

async function insertKeys(
	accountId: string,
	count: number,
	product: "account" | "docs",
) {
	await db
		.insertInto("api_keys")
		.values(
			Array.from({ length: count }, () => {
				const raw = `sk-sl_cap_${crypto.randomUUID()}`;
				return {
					key_hash: hashToken(raw),
					key_prefix: raw.slice(0, 14),
					account_id: accountId,
					ip_address: "test",
					product,
					tier: "free",
					status: "active" as const,
				};
			}),
		)
		.execute();
}

describe.skipIf(!HAS_DB)("account key creation limits", () => {
	test("the 51st active key is refused and docs keys do not count", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		await insertKeys(accountId, 1, "docs");
		await insertKeys(accountId, 49, "account");
		expect((await createKey(session)).status).toBe(201);
		const refused = await createKey(session);
		expect(refused.status).toBe(403);
		const active = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", accountId)
			.where("product", "=", "account")
			.execute();
		expect(active).toHaveLength(50);
	});

	test("the 21st key created within an hour gets a 429 with Retry-After", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		for (let i = 0; i < 20; i++) {
			expect((await createKey(session)).status).toBe(201);
		}
		const limited = await createKey(session);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
	});
});
