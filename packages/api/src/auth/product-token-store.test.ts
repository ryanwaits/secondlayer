import { describe, expect, test } from "bun:test";
import {
	accountPlanToProductTier,
	createRuntimeProductTokenStore,
	type ProductTenant,
} from "./product-token-store.ts";
import { generateApiKey, hashToken } from "./keys.ts";

const REQUIRED_SCOPE = "index:read";

describe("runtime product token store", () => {
	test("prefers seeded tokens without hitting the runtime lookup", async () => {
		let lookupCalls = 0;
		const seededTenant: ProductTenant<"build"> = {
			tenant_id: "tenant_seeded",
			tier: "build",
			scopes: [REQUIRED_SCOPE],
		};
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map([["sk-sl_seeded", seededTenant]]),
			requiredScope: REQUIRED_SCOPE,
			product: "index",
			lookupApiKey: async () => {
				lookupCalls++;
				return null;
			},
		});

		await expect(store.get("sk-sl_seeded")).resolves.toEqual(seededTenant);
		expect(lookupCalls).toBe(0);
	});

	test("resolves active database API keys at request time", async () => {
		const { raw } = generateApiKey();
		let seenHash = "";
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "index",
			lookupApiKey: async (tokenHash) => {
				seenHash = tokenHash;
				return {
					account_id: "acct_runtime",
					plan: "scale",
					status: "active",
					product: "account",
					tier: null,
				};
			},
		});

		await expect(store.get(raw)).resolves.toEqual({
			tenant_id: "account:acct_runtime",
			account_id: "acct_runtime",
			tier: "scale",
			scopes: [REQUIRED_SCOPE],
		});
		expect(seenHash).toBe(hashToken(raw));
	});

	test("does not authorize missing or revoked runtime keys", async () => {
		const { raw } = generateApiKey();
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "index",
			lookupApiKey: async () => ({
				account_id: "acct_runtime",
				plan: "build",
				status: "revoked",
				product: "account",
				tier: null,
			}),
		});

		await expect(store.get(raw)).resolves.toBeUndefined();
		await expect(store.get("not-an-api-key")).resolves.toBeUndefined();
	});

	test("uses api_keys.tier override when present", async () => {
		const { raw } = generateApiKey();
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "streams",
			lookupApiKey: async () => ({
				account_id: "acct_runtime",
				plan: "build",
				status: "active",
				product: "streams",
				tier: "scale",
			}),
		});

		const tenant = await store.get(raw);
		expect(tenant?.tier).toBe("scale");
	});

	test("falls back to account plan when key tier is null", async () => {
		const { raw } = generateApiKey();
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "streams",
			lookupApiKey: async () => ({
				account_id: "acct_runtime",
				plan: "build",
				status: "active",
				product: "streams",
				tier: null,
			}),
		});

		const tenant = await store.get(raw);
		expect(tenant?.tier).toBe("build");
	});

	test("maps account plans to product tiers", () => {
		expect(accountPlanToProductTier("launch")).toBe("build");
		expect(accountPlanToProductTier("build")).toBe("build");
		expect(accountPlanToProductTier("scale")).toBe("scale");
		expect(accountPlanToProductTier("enterprise")).toBe("enterprise");
		expect(accountPlanToProductTier("none")).toBe("free");
	});
});
