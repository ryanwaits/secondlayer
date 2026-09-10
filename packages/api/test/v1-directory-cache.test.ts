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
import { hashToken } from "../src/auth/keys.ts";
import { errorHandler } from "../src/middleware/error.ts";
import v1SubgraphsRouter, {
	resetAnonDirectoryCache,
} from "../src/routes/v1-subgraphs.ts";

/**
 * Anon `/v1/subgraphs` directory memoization is an OSS loopback feature.
 * Hosted (`platform`) directory reads are keyed; anon is 401.
 */

const SKIP = !process.env.DATABASE_URL;

const ENV_KEYS = ["INSTANCE_MODE", "LISTEN_HOST", "API_PUBLISH_ADDR"] as const;

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/", v1SubgraphsRouter);
	return app;
}

describe.skipIf(SKIP)("anon /v1/subgraphs directory cache", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of ENV_KEYS) saved[k] = process.env[k];
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "127.0.0.1";
		delete process.env.API_PUBLISH_ADDR;
		resetAnonDirectoryCache();
	});

	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	test("two anon requests within the TTL return byte-identical bodies and the same ETag", async () => {
		const app = buildApp();
		const first = await app.request("/");
		const firstBody = await first.text();
		const firstEtag = first.headers.get("etag");
		expect(first.status).toBe(200);
		expect(firstEtag).toBeTruthy();

		const second = await app.request("/");
		const secondBody = await second.text();
		const secondEtag = second.headers.get("etag");

		expect(secondBody).toBe(firstBody);
		expect(secondEtag).toBe(firstEtag);
	});

	test("If-None-Match with the cached ETag returns 304", async () => {
		const app = buildApp();
		const first = await app.request("/");
		const etag = first.headers.get("etag");
		expect(etag).toBeTruthy();

		const revalidated = await app.request("/", {
			headers: { "if-none-match": String(etag) },
		});
		expect(revalidated.status).toBe(304);
	});
});

describe.skipIf(SKIP)("hosted /v1/subgraphs directory", () => {
	const createdAccountIds: string[] = [];
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of ENV_KEYS) saved[k] = process.env[k];
		process.env.INSTANCE_MODE = "platform";
		resetAnonDirectoryCache();
	});

	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	afterAll(async () => {
		const db = getDb();
		for (const id of createdAccountIds) {
			await db.deleteFrom("api_keys").where("account_id", "=", id).execute();
			await db.deleteFrom("accounts").where("id", "=", id).execute();
		}
	});

	async function makeApiKey(): Promise<string> {
		const db = getDb();
		const account = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		createdAccountIds.push(account.id);
		const raw = `sk-sl_${crypto.randomUUID()}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(raw),
				key_prefix: "sk-sl_test",
				account_id: account.id,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
			})
			.execute();
		return raw;
	}

	test("anon GET is 401", async () => {
		const app = buildApp();
		expect((await app.request("/")).status).toBe(401);
	});

	test("account key 200s without cache headers", async () => {
		const apiKeyRaw = await makeApiKey();
		const app = buildApp();
		const authed = await app.request("/", {
			headers: { authorization: `Bearer ${apiKeyRaw}` },
		});
		expect(authed.status).toBe(200);
		expect(authed.headers.get("etag")).toBeNull();
		expect(authed.headers.get("cache-control")).toBeNull();
	});
});
