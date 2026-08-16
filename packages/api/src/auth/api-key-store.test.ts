import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createApiKeyTokenStore } from "./api-key-store.ts";
import { hashToken } from "./keys.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const STATIC = new Map([
	[
		"sk-sl_static_seed",
		{
			tenant_id: "tenant_static",
			tier: "free" as const,
			scopes: ["index:read"],
		},
	],
]);

describe("createApiKeyTokenStore", () => {
	test("static seed tokens resolve without touching the db", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: STATIC,
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => {
				throw new Error("db must not be hit for seeded tokens");
			},
		});
		const tenant = await store.get("sk-sl_static_seed");
		expect(tenant?.tenant_id).toBe("tenant_static");
	});

	test("non sk-sl_ tokens never hit the db", async () => {
		let called = false;
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => {
				called = true;
				return null;
			},
		});
		expect(await store.get("ss-sl_session_token")).toBeUndefined();
		expect(called).toBe(false);
	});

	describe.skipIf(!HAS_DB)(
		"DB-backed lookup (default lookupAccountApiKey)",
		() => {
			const db = getDb();
			const TEST_EMAIL = `api-key-store-test-${Date.now()}@example.com`;
			let accountId: string;
			let prevMode: string | undefined;

			beforeAll(async () => {
				// The default DB lookup path is platform-only; oss short-circuits it.
				prevMode = process.env.INSTANCE_MODE;
				process.env.INSTANCE_MODE = "platform";
				const row = await db
					.insertInto("accounts")
					.values({ email: TEST_EMAIL })
					.returning("id")
					.executeTakeFirstOrThrow();
				accountId = row.id;
			});

			afterAll(async () => {
				if (prevMode === undefined) delete process.env.INSTANCE_MODE;
				else process.env.INSTANCE_MODE = prevMode;
				await db
					.deleteFrom("api_keys")
					.where("account_id", "=", accountId)
					.execute();
				await db.deleteFrom("accounts").where("id", "=", accountId).execute();
			});

			test("a legacy paid-tier pin on the DB row resolves to free, not the pin", async () => {
				const raw = "sk-sl_legacy_enterprise_pin_test";
				await db
					.insertInto("api_keys")
					.values({
						key_hash: hashToken(raw),
						key_prefix: "sk-sl_legacy",
						account_id: accountId,
						ip_address: "test",
						product: "streams",
						// Legacy pin from before the paid ladder was retired. The DB
						// column stays wide (out of scope for this plan) but the
						// resolver must never treat it as authority.
						tier: "enterprise",
						status: "active",
					})
					.execute();

				const store = createApiKeyTokenStore({
					staticTokens: new Map(),
					requiredScope: "streams:read",
					product: "streams",
				});
				const tenant = await store.get(raw);
				expect(tenant?.tier).toBe("free");
			});
		},
	);

	test("null key tier defaults to free (read-credits gate contract)", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => ({
				account_id: "acct_2",
				status: "active",
				tier: null,
			}),
		});
		const tenant = await store.get("sk-sl_key");
		expect(tenant?.tier).toBe("free");
	});

	test("inactive keys are rejected", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => ({
				account_id: "acct_3",
				status: "revoked",
				tier: "free",
			}),
		});
		expect(await store.get("sk-sl_key")).toBeUndefined();
	});

	test("unknown keys are rejected", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => null,
		});
		expect(await store.get("sk-sl_key")).toBeUndefined();
	});
});
