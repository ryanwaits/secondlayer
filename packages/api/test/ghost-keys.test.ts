import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { hashToken } from "../src/auth/keys.ts";
import { requireAuth } from "../src/auth/middleware.ts";
import { _resetRateLimitStoreForTests } from "../src/auth/rate-limit-store.ts";
import { errorHandler } from "../src/middleware/error.ts";
import { createV1KeysRouter } from "../src/routes/v1-keys.ts";

/**
 * Ghost-key mint + read-only guard, against the real DB. Each test uses a
 * distinct x-forwarded-for IP so per-IP buckets don't interfere; the in-proc
 * rate-limit store is forced (REDIS_URL cleared) so counts are deterministic.
 */

const mintedKeyHashes: string[] = [];

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/v1/keys", createV1KeysRouter());
	// Stand-ins for requireAuth-gated product routes: one read, one write.
	app.get("/gated/read", requireAuth(), (c) => c.json({ ok: true }));
	app.post("/gated/write", requireAuth(), (c) => c.json({ ok: true }));
	return app;
}

async function mint(
	app: Hono,
	ip: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await app.request("/v1/keys", {
		method: "POST",
		headers: { "x-forwarded-for": ip },
	});
	const body = (await res.json()) as Record<string, unknown>;
	if (res.status === 201 && typeof body.key === "string") {
		mintedKeyHashes.push(hashToken(body.key));
	}
	return { status: res.status, body };
}

beforeAll(async () => {
	process.env.DEV_MODE = "false";
	// Reflect form: biome's noDelete flags the `delete` operator, and a plain
	// `= undefined` would coerce to the string "undefined" in process.env.
	Reflect.deleteProperty(process.env, "REDIS_URL");
	await _resetRateLimitStoreForTests();
});

afterAll(async () => {
	// Delete the ghost accounts created here (cascades api_keys + claim_tokens).
	if (mintedKeyHashes.length === 0) return;
	const db = getDb();
	const keys = await db
		.selectFrom("api_keys")
		.select("account_id")
		.where("key_hash", "in", mintedKeyHashes)
		.execute();
	const accountIds = [...new Set(keys.map((k) => k.account_id))];
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe("POST /v1/keys (ghost mint)", () => {
	test("mints a key once with claim URL; key works on a gated GET", async () => {
		const app = buildApp();
		const { status, body } = await mint(app, "203.0.113.10");
		expect(status).toBe(201);
		expect(String(body.key)).toStartWith("sk-sl_");
		expect(body.tier).toBe("free");
		expect(body.scopes).toEqual(["streams:read", "index:read"]);
		expect(String(body.claim_url)).toContain("/claim/");

		const read = await app.request("/gated/read", {
			headers: { Authorization: `Bearer ${body.key}` },
		});
		expect(read.status).toBe(200);

		// Ghost flag is set and email is NULL on the minted account.
		const db = getDb();
		const account = await db
			.selectFrom("api_keys")
			.innerJoin("accounts", "accounts.id", "api_keys.account_id")
			.select(["accounts.ghost", "accounts.email"])
			.where("api_keys.key_hash", "=", hashToken(String(body.key)))
			.executeTakeFirstOrThrow();
		expect(account.ghost).toBe(true);
		expect(account.email).toBeNull();
	});

	test("ghost key gets 403 GHOST_KEY_READ_ONLY on a gated POST", async () => {
		const app = buildApp();
		const { status, body } = await mint(app, "203.0.113.11");
		expect(status).toBe(201);

		const write = await app.request("/gated/write", {
			method: "POST",
			headers: { Authorization: `Bearer ${body.key}` },
		});
		expect(write.status).toBe(403);
		expect(((await write.json()) as { code: string }).code).toBe(
			"GHOST_KEY_READ_ONLY",
		);
	});

	test("4th mint from the same IP is 429", async () => {
		const app = buildApp();
		const ip = "203.0.113.12";
		for (let i = 0; i < 3; i++) {
			const { status } = await mint(app, ip);
			expect(status).toBe(201);
		}
		const fourth = await mint(app, ip);
		expect(fourth.status).toBe(429);
		expect(fourth.body.code).toBe("RATE_LIMIT_ERROR");
	});
});
