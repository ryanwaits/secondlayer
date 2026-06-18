import { describe, expect, test } from "bun:test";
import { generateApiKey, hashToken } from "./keys.ts";
import {
	type ProductTenant,
	accountPlanToProductTier,
	createRuntimeProductTokenStore,
} from "./product-token-store.ts";

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

	// R6: a key's pinned tier may upgrade above its plan, never downgrade below
	// it — otherwise a ghost key's `tier='free'` merged onto a paid account would
	// meter (and rate-limit) that paying customer as free.
	test("key tier below the account plan is ignored (no downgrade)", async () => {
		const { raw } = generateApiKey();
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "index",
			lookupApiKey: async () => ({
				account_id: "acct_paid",
				plan: "scale",
				status: "active",
				product: "account",
				tier: "free", // stray/merged ghost tier
			}),
		});
		const tenant = await store.get(raw);
		expect(tenant?.tier).toBe("scale");
	});

	test("key tier above the account plan upgrades", async () => {
		const { raw } = generateApiKey();
		const store = createRuntimeProductTokenStore({
			staticTokens: new Map(),
			requiredScope: REQUIRED_SCOPE,
			product: "index",
			lookupApiKey: async () => ({
				account_id: "acct_free",
				plan: "none",
				status: "active",
				product: "account",
				tier: "enterprise",
			}),
		});
		const tenant = await store.get(raw);
		expect(tenant?.tier).toBe("enterprise");
	});

	test("maps account plans to product tiers (single-sourced from PLANS)", () => {
		expect(accountPlanToProductTier("launch")).toBe("build");
		expect(accountPlanToProductTier("scale")).toBe("scale");
		expect(accountPlanToProductTier("enterprise")).toBe("enterprise");
		// No-plan cases → free.
		expect(accountPlanToProductTier("none")).toBe("free");
		expect(accountPlanToProductTier("")).toBe("free");
		expect(accountPlanToProductTier("hobby")).toBe("free");
		// Legacy aliases still resolve.
		expect(accountPlanToProductTier("build")).toBe("build");
		expect(accountPlanToProductTier("pro")).toBe("build");
		expect(accountPlanToProductTier("builder")).toBe("build");
		// Unknown plan → safe free default (and logs a drift alarm).
		expect(accountPlanToProductTier("platinum")).toBe("free");
	});
});
