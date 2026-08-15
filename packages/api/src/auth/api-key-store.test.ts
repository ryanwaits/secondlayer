import { describe, expect, test } from "bun:test";
import { createApiKeyTokenStore } from "./api-key-store.ts";

const STATIC = new Map([
	[
		"sk-sl_static_seed",
		{
			tenant_id: "tenant_static",
			tier: "enterprise" as const,
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

	test("tier comes from the api_keys.tier column", async () => {
		const store = createApiKeyTokenStore({
			staticTokens: new Map(),
			requiredScope: "streams:read",
			product: "streams",
			lookupApiKey: async () => ({
				account_id: "acct_1",
				status: "active",
				tier: "build",
			}),
		});
		const tenant = await store.get("sk-sl_key");
		expect(tenant).toEqual({
			tenant_id: "account:acct_1",
			account_id: "acct_1",
			tier: "build",
			scopes: ["streams:read"],
		});
	});

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
				tier: "build",
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
