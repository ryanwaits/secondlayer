import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { hashToken } from "../src/auth/keys.ts";
import { errorHandler } from "../src/middleware/error.ts";
import v1SubgraphsRouter, {
	resetAnonDirectoryCache,
} from "../src/routes/v1-subgraphs.ts";

/**
 * Anon `/v1/subgraphs` directory memoization: the anonymous directory body
 * (row counts + tip + per-subgraph summaries) is expensive to recompute and
 * only varies for authenticated callers, so anon hits within the TTL are
 * served from memory, including the 304 revalidation path.
 */

const SKIP = !process.env.DATABASE_URL;

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/", v1SubgraphsRouter);
	return app;
}

describe.skipIf(SKIP)("anon /v1/subgraphs directory cache", () => {
	const createdAccountIds: string[] = [];
	let apiKeyRaw: string;

	beforeEach(() => {
		resetAnonDirectoryCache();
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

	test("an authenticated request during the same window bypasses the anon cache entirely", async () => {
		apiKeyRaw = await makeApiKey();
		const app = buildApp();

		// Populate the anon cache first.
		const anon = await app.request("/");
		expect(anon.headers.get("etag")).toBeTruthy();
		expect(anon.headers.get("cache-control")).toBeTruthy();

		const authed = await app.request("/", {
			headers: { authorization: `Bearer ${apiKeyRaw}` },
		});
		expect(authed.status).toBe(200);
		// The keyed view never advertises caching — if it did, it would mean
		// the authed branch fell through to the anon-cache path.
		expect(authed.headers.get("etag")).toBeNull();
		expect(authed.headers.get("cache-control")).toBeNull();
	});
});
