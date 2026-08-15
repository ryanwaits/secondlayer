import { getDb as defaultGetDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { hashToken } from "./keys.ts";

/** Single metered-tier vocabulary. `free` is the metered default; the paid
 *  values survive only as per-key pins on legacy `api_keys.tier` rows. */
export type ProductTier = "free" | "build" | "scale" | "enterprise";

export type ProductTenant<TTier extends ProductTier = ProductTier> = {
	tenant_id: string;
	account_id?: string;
	tier: TTier;
	scopes: readonly string[];
};

export type ProductTokenStore<TTenant> = {
	get(rawToken: string): TTenant | undefined | Promise<TTenant | undefined>;
};

export type ProductScope = "streams" | "index";

type ApiKeyRecord = {
	account_id: string;
	status: string;
	tier: ProductTier | null;
};

type ApiKeyTokenStoreOptions<TTenant extends ProductTenant> = {
	staticTokens: ProductTokenStore<TTenant>;
	requiredScope: string;
	product: ProductScope;
	getDb?: typeof defaultGetDb;
	lookupApiKey?: (
		tokenHash: string,
		product: ProductScope,
		getDb: typeof defaultGetDb,
	) => Promise<ApiKeyRecord | null>;
};

async function lookupAccountApiKey(
	tokenHash: string,
	product: ProductScope,
	getDb: typeof defaultGetDb,
): Promise<ApiKeyRecord | null> {
	const db = getDb();
	const row = await db
		.selectFrom("api_keys")
		.select(["account_id", "status", "tier"])
		.where("key_hash", "=", tokenHash)
		.where("product", "in", ["account", product])
		.executeTakeFirst();

	if (!row) return null;
	return {
		account_id: row.account_id,
		status: row.status,
		tier: (row.tier as ProductTier | null) ?? null,
	};
}

/**
 * Runtime token store for the metered archive: static seed tokens first, then
 * `api_keys` by hash. Tier is the key's own `api_keys.tier` column (minted
 * `free`; legacy paid pins honored) — there is no account-plan authority.
 */
export function createApiKeyTokenStore<TTenant extends ProductTenant>(
	opts: ApiKeyTokenStoreOptions<TTenant>,
): ProductTokenStore<TTenant> {
	const getDb = opts.getDb ?? defaultGetDb;
	const lookupApiKey = opts.lookupApiKey ?? lookupAccountApiKey;

	return {
		async get(rawToken: string): Promise<TTenant | undefined> {
			const seeded = await opts.staticTokens.get(rawToken);
			if (seeded) return seeded;
			if (!rawToken.startsWith("sk-sl_")) return undefined;
			// OSS has no product keys. Injected lookupApiKey is tests only.
			if (!isPlatformMode() && opts.lookupApiKey === undefined) {
				return undefined;
			}

			const key = await lookupApiKey(hashToken(rawToken), opts.product, getDb);
			if (!key || key.status !== "active") return undefined;

			return {
				tenant_id: `account:${key.account_id}`,
				account_id: key.account_id,
				tier: key.tier ?? "free",
				scopes: [opts.requiredScope],
			} as unknown as TTenant;
		},
	};
}
