import { getDb as defaultGetDb } from "@secondlayer/shared/db";
import { hashToken } from "./keys.ts";

export type ProductTier = "free" | "build" | "scale" | "enterprise";

export type ProductTenant<TTier extends ProductTier = ProductTier> = {
	tenant_id: string;
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
};

type ProductTokenStoreOptions<TTenant extends ProductTenant> = {
	staticTokens: ProductTokenStore<TTenant>;
	requiredScope: string;
	getDb?: typeof defaultGetDb;
	lookupApiKey?: (
		tokenHash: string,
		getDb: typeof defaultGetDb,
	) => Promise<AccountApiKeyRecord | null>;
};

export function accountPlanToProductTier(plan: string): ProductTier {
	switch (plan.toLowerCase()) {
		case "enterprise":
			return "enterprise";
		case "scale":
			return "scale";
		case "build":
		case "launch":
		case "pro":
		case "builder":
			return "build";
		default:
			return "free";
	}
}

async function lookupAccountApiKey(
	tokenHash: string,
	getDb: typeof defaultGetDb,
): Promise<AccountApiKeyRecord | null> {
	const db = getDb();
	const row = await db
		.selectFrom("api_keys")
		.innerJoin("accounts", "accounts.id", "api_keys.account_id")
		.select([
			"api_keys.account_id as account_id",
			"api_keys.status as status",
			"accounts.plan as plan",
		])
		.where("api_keys.key_hash", "=", tokenHash)
		.executeTakeFirst();

	return row ?? null;
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

			const key = await lookupApiKey(hashToken(rawToken), getDb);
			if (!key || key.status !== "active") return undefined;

			return {
				tenant_id: `account:${key.account_id}`,
				tier: accountPlanToProductTier(key.plan),
				scopes: [opts.requiredScope],
			} as unknown as TTenant;
		},
	};
}
