import {
	PLAN_TO_PRODUCT_TIER,
	isValidPlanId,
} from "@secondlayer/platform/pricing";
import { logger } from "@secondlayer/shared";
import { getDb as defaultGetDb } from "@secondlayer/shared/db";
import { hashToken } from "./keys.ts";

export type ProductTier = "free" | "build" | "scale" | "enterprise";

/** Tier ordering: a key's pinned tier may UPGRADE above its account plan, never
 *  downgrade below it (so a stray `tier='free'` can't meter a paid account). */
const TIER_RANK: Record<ProductTier, number> = {
	free: 0,
	build: 1,
	scale: 2,
	enterprise: 3,
};

// Legacy `accounts.plan` strings predating the canonical PlanIds. Kept until a
// data check confirms no rows still carry them, then drop.
const LEGACY_PLAN_ALIASES: Record<string, ProductTier> = {
	pro: "build",
	build: "build",
	builder: "build",
};

export type ProductTenant<TTier extends ProductTier = ProductTier> = {
	tenant_id: string;
	account_id?: string;
	tier: TTier;
	scopes: readonly string[];
};

export type ProductTokenStore<TTenant> = {
	get(rawToken: string): TTenant | undefined | Promise<TTenant | undefined>;
};

type AccountApiKeyRecord = {
	account_id: string;
	plan: string;
	status: string;
	product: "account" | "streams" | "index";
	tier: ProductTier | null;
};

export type ProductScope = "streams" | "index";

type ProductTokenStoreOptions<TTenant extends ProductTenant> = {
	staticTokens: ProductTokenStore<TTenant>;
	requiredScope: string;
	product: ProductScope;
	getDb?: typeof defaultGetDb;
	lookupApiKey?: (
		tokenHash: string,
		product: ProductScope,
		getDb: typeof defaultGetDb,
	) => Promise<AccountApiKeyRecord | null>;
};

export function accountPlanToProductTier(plan: string): ProductTier {
	const normalized = plan.trim().toLowerCase();
	// Legitimate "no plan" → free tier.
	if (normalized === "" || normalized === "none" || normalized === "hobby") {
		return "free";
	}
	// Canonical PlanIds resolve via the single source colocated with PLANS.
	if (isValidPlanId(normalized)) return PLAN_TO_PRODUCT_TIER[normalized];
	const legacy = LEGACY_PLAN_ALIASES[normalized];
	if (legacy) return legacy;
	// Unknown non-empty plan = drift between accounts.plan and PLANS. Don't
	// silently treat a paid-looking id as free — alarm and fall back safely.
	logger.error("Unknown account plan — tier drift; defaulting to free", {
		plan,
	});
	return "free";
}

async function lookupAccountApiKey(
	tokenHash: string,
	product: ProductScope,
	getDb: typeof defaultGetDb,
): Promise<AccountApiKeyRecord | null> {
	const db = getDb();
	const row = await db
		.selectFrom("api_keys")
		.innerJoin("accounts", "accounts.id", "api_keys.account_id")
		.select([
			"api_keys.account_id as account_id",
			"api_keys.status as status",
			"api_keys.product as product",
			"api_keys.tier as tier",
			"accounts.plan as plan",
		])
		.where("api_keys.key_hash", "=", tokenHash)
		.where("api_keys.product", "in", ["account", product])
		.executeTakeFirst();

	if (!row) return null;
	return {
		account_id: row.account_id,
		status: row.status,
		plan: row.plan,
		product: row.product as "account" | "streams" | "index",
		tier: (row.tier as ProductTier | null) ?? null,
	};
}

export function createRuntimeProductTokenStore<TTenant extends ProductTenant>(
	opts: ProductTokenStoreOptions<TTenant>,
): ProductTokenStore<TTenant> {
	const getDb = opts.getDb ?? defaultGetDb;
	const lookupApiKey = opts.lookupApiKey ?? lookupAccountApiKey;

	return {
		async get(rawToken: string): Promise<TTenant | undefined> {
			const seeded = await opts.staticTokens.get(rawToken);
			if (seeded) return seeded;
			if (!rawToken.startsWith("sk-sl_")) return undefined;

			const key = await lookupApiKey(hashToken(rawToken), opts.product, getDb);
			if (!key || key.status !== "active") return undefined;

			// A key's pinned tier may only UPGRADE above the account plan, never
			// downgrade below it — otherwise a stray `tier='free'` (e.g. a ghost
			// key merged onto a paid account) would meter a paying customer.
			const planTier = accountPlanToProductTier(key.plan);
			const tier =
				key.tier && TIER_RANK[key.tier] > TIER_RANK[planTier]
					? key.tier
					: planTier;

			return {
				tenant_id: `account:${key.account_id}`,
				account_id: key.account_id,
				tier,
				scopes: [opts.requiredScope],
			} as unknown as TTenant;
		},
	};
}
