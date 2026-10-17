import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	type ProductTenant,
	createApiKeyTokenStore,
	findRevokedAccountKey,
} from "./api-key-store.ts";
import { hashToken } from "./keys.ts";

const HAS_DB = !!process.env.DATABASE_URL;

function restoreEnv(key: string, prev: string | undefined): void {
	if (prev === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = prev;
}

const STATIC = new Map<string, ProductTenant>([
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

	test("INSTANCE_TOKEN does not authenticate on platform", async () => {
		const prevMode = process.env.INSTANCE_MODE;
		const prevToken = process.env.INSTANCE_TOKEN;
		process.env.INSTANCE_MODE = "platform";
		process.env.INSTANCE_TOKEN = "deadbeefplatformhex";
		try {
			const store = createApiKeyTokenStore({
				staticTokens: new Map(),
				requiredScope: "index:read",
				product: "index",
				lookupApiKey: async () => {
					throw new Error("db must not be hit for hex instance token");
				},
			});
			expect(await store.get("deadbeefplatformhex")).toBeUndefined();
		} finally {
			restoreEnv("INSTANCE_MODE", prevMode);
			restoreEnv("INSTANCE_TOKEN", prevToken);
		}
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

			test("findRevokedAccountKey matches only revoked account keys", async () => {
				const insertKey = async (
					product: "account" | "docs",
					status: "active" | "revoked",
				) => {
					const raw = `sk-sl_revoked_lookup_${crypto.randomUUID()}`;
					const row = await db
						.insertInto("api_keys")
						.values({
							key_hash: hashToken(raw),
							key_prefix: raw.slice(0, 14),
							account_id: accountId,
							ip_address: "test",
							product,
							tier: "free",
							status,
						})
						.returning("id")
						.executeTakeFirstOrThrow();
					return { raw, id: row.id };
				};
				const revoked = await insertKey("account", "revoked");
				expect(await findRevokedAccountKey(revoked.raw)).toEqual({
					id: revoked.id,
					account_id: accountId,
				});
				expect(
					await findRevokedAccountKey(
						(await insertKey("account", "active")).raw,
					),
				).toBeNull();
				expect(
					await findRevokedAccountKey((await insertKey("docs", "revoked")).raw),
				).toBeNull();
				expect(await findRevokedAccountKey("sk-sl_unknown_key")).toBeNull();
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
						product: "account",
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

			test("a first-party internal key resolves as internal and keeps its account", async () => {
				const raw = "sk-sl_hosted_stack_internal_test";
				await db
					.insertInto("api_keys")
					.values({
						key_hash: hashToken(raw),
						key_prefix: "sk-sl_hosted",
						account_id: accountId,
						ip_address: "workload-host",
						product: "account",
						tier: "internal",
						status: "active",
					})
					.execute();

				const store = createApiKeyTokenStore({
					staticTokens: new Map(),
					requiredScope: "index:read",
					product: "index",
				});
				const tenant = await store.get(raw);
				expect(tenant?.tier).toBe("internal");
				expect(tenant?.account_id).toBe(accountId);
			});

			test("an active scoped streams key does not resolve", async () => {
				const raw = "sk-sl_scoped_streams_retired_test";
				await db
					.insertInto("api_keys")
					.values({
						key_hash: hashToken(raw),
						key_prefix: "sk-sl_scoped",
						account_id: accountId,
						ip_address: "test",
						product: "streams",
						tier: "free",
						status: "active",
					})
					.execute();

				const store = createApiKeyTokenStore({
					staticTokens: new Map(),
					requiredScope: "streams:read",
					product: "streams",
				});
				expect(await store.get(raw)).toBeUndefined();
			});

			test("an active sentinel key does not resolve on any product route", async () => {
				const raw = "sk-sl_sentinel_product_rejected_test";
				await db
					.insertInto("api_keys")
					.values({
						key_hash: hashToken(raw),
						key_prefix: "sk-sl_sentine",
						account_id: accountId,
						ip_address: "test",
						product: "sentinel",
						tier: "free",
						status: "active",
					})
					.execute();

				for (const product of ["streams", "index"] as const) {
					const store = createApiKeyTokenStore({
						staticTokens: new Map(),
						requiredScope: `${product}:read`,
						product,
					});
					expect(await store.get(raw)).toBeUndefined();
				}
			});

			test("a tenant-product key reads the index plane and the chain-read scope; an account key reads only the index plane", async () => {
				const tenantRaw = `sk-sl_tenant_product_test_${crypto.randomUUID()}`;
				const accountRaw = `sk-sl_account_product_test_${crypto.randomUUID()}`;
				for (const [raw, product] of [
					[tenantRaw, "tenant"],
					[accountRaw, "account"],
				] as const) {
					await db
						.insertInto("api_keys")
						.values({
							key_hash: hashToken(raw),
							key_prefix: raw.slice(0, 14),
							account_id: accountId,
							ip_address: "workload-host",
							product,
							tier: "free",
							status: "active",
						})
						.execute();
				}

				const storeFor = (product: "index" | "streams" | "chain-read") =>
					createApiKeyTokenStore({
						staticTokens: new Map(),
						requiredScope: `${product}:read`,
						product,
					});

				for (const product of ["index", "streams"] as const) {
					expect((await storeFor(product).get(tenantRaw))?.account_id).toBe(
						accountId,
					);
					expect((await storeFor(product).get(accountRaw))?.account_id).toBe(
						accountId,
					);
				}
				expect((await storeFor("chain-read").get(tenantRaw))?.account_id).toBe(
					accountId,
				);
				expect(await storeFor("chain-read").get(accountRaw)).toBeUndefined();
			});
		},
	);

	test("null key tier defaults to free (read-credits gate contract)", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => ({
				id: "11111111-1111-4111-8111-111111111111",
				account_id: "acct_2",
				status: "active",
				tier: null,
			}),
		});
		const tenant = await store.get("sk-sl_key");
		expect(tenant?.tier).toBe("free");
	});

	test("DB-backed key tenant carries api_key_id; static tokens do not", async () => {
		const keyId = "22222222-2222-4222-8222-222222222222";
		const store = createApiKeyTokenStore({
			staticTokens: STATIC,
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => ({
				id: keyId,
				account_id: "acct_4",
				status: "active",
				tier: "free",
			}),
		});
		const keyed = await store.get("sk-sl_key");
		expect(keyed?.api_key_id).toBe(keyId);
		const seeded = await store.get("sk-sl_static_seed");
		expect(seeded?.api_key_id).toBeUndefined();
	});

	test("inactive keys are rejected", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "index:read",
			product: "index",
			lookupApiKey: async () => ({
				id: "11111111-1111-4111-8111-111111111111",
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
