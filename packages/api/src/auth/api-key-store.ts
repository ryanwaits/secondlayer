import { getDb as defaultGetDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { instanceTokenMatches } from "../instance-bind.ts";
import { hashToken } from "./keys.ts";
import { INSTANCE_TENANT_ID } from "./read-plane.ts";

/** Two kinds of caller: `free` is the single metered tier every minted key
 *  gets (see auth/mint.ts), `internal` is a first-party service credential
 *  that is neither throttled nor metered. There is no paid ladder. */
export type ProductTier = "free" | "internal";

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
		// DB-backed keys are always the single metered tier. Legacy `build`/
		// `scale`/`enterprise` pins on old rows are not authority — the paid
		// ladder was retired and the column is vestigial.
		status: row.status,
		tier: "free",
	};
}

/**
 * Runtime token store: static seed tokens (first-party service credentials)
 * first, then the instance token, then `api_keys` by hash on the metered
 * archive. Every DB-backed key resolves to the single metered `free` tier —
 * legacy paid pins on `api_keys.tier` are not honored.
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
			// The instance's own token authenticates every plane. A self-hosted
			// instance has one credential (bare hex from `secondlayer init`), not
			// a per-product `sk-sl_` key, so it must be resolved before the
			// prefix guard below — that guard is what made the documented token
			// unusable against the whole `/v1` plane.
			if (instanceTokenMatches(rawToken)) {
				return {
					tenant_id: INSTANCE_TENANT_ID,
					// No account_id: the operator's own reads are never metered
					// and never throttled.
					tier: "internal",
					scopes: [opts.requiredScope],
				} as unknown as TTenant;
			}
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
