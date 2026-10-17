import { getDb as defaultGetDb, sql } from "@secondlayer/shared/db";
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
	/** Set only for DB-backed `sk-sl_` keys; absent for static seed tokens
	 *  and the self-host instance token. */
	api_key_id?: string;
	scopes: readonly string[];
};

export type ProductTokenStore<TTenant> = {
	get(rawToken: string): TTenant | undefined | Promise<TTenant | undefined>;
};

export type RevokedAccountKey = { id: string; account_id: string };

/** A revoked `account` key behind this raw token, or null. Only called on
 *  the failure path (the token did not authenticate), platform only. */
export async function findRevokedAccountKey(
	rawToken: string,
	getDb: typeof defaultGetDb = defaultGetDb,
): Promise<RevokedAccountKey | null> {
	if (!isPlatformMode() || !rawToken.startsWith("sk-sl_")) return null;
	const row = await getDb()
		.selectFrom("api_keys")
		.select(["id", "account_id"])
		.where("key_hash", "=", hashToken(rawToken))
		.where("product", "=", "account")
		.where("status", "=", "revoked")
		.executeTakeFirst();
	return row ?? null;
}

export type ProductScope = "streams" | "index" | "sentinel" | "chain-read";

type ApiKeyRecord = {
	id: string;
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

/**
 * Which `api_keys.product` values authenticate a product scope. Short-lived
 * `docs` keys and the workload host's `tenant` keys read Streams and Index
 * only, never a plane that could do more than read. The hosted chain-read
 * route takes tenant keys only: a customer key there would be a free node
 * query service.
 */
function acceptedKeyProducts(
	product: ProductScope,
): Array<"account" | "docs" | "tenant"> {
	switch (product) {
		case "streams":
		case "index":
			return ["account", "docs", "tenant"];
		case "chain-read":
			return ["tenant"];
		default:
			return ["account"];
	}
}

async function lookupAccountApiKey(
	tokenHash: string,
	product: ProductScope,
	getDb: typeof defaultGetDb,
): Promise<ApiKeyRecord | null> {
	const db = getDb();
	// Scoped streams/index rows are retired (auth-007). Expiry is enforced
	// here, on every lookup, in SQL: a key past `expires_at` is simply not
	// found.
	const row = await db
		.selectFrom("api_keys")
		.select(["id", "account_id", "status", "tier"])
		.where("key_hash", "=", tokenHash)
		.where("product", "in", acceptedKeyProducts(product))
		.where((eb) =>
			eb.or([
				eb("expires_at", "is", null),
				eb("expires_at", ">", sql<Date>`now()`),
			]),
		)
		.executeTakeFirst();

	if (!row) return null;
	return {
		id: row.id,
		account_id: row.account_id,
		// DB-backed keys are the single metered tier, except a first-party
		// `internal` key (only mintable by an internal route, see
		// `INTERNAL_MINT_TIER`). Legacy `build`/`scale`/`enterprise` pins on
		// old rows are not authority: the paid ladder was retired.
		status: row.status,
		tier: row.tier === "internal" ? "internal" : "free",
	};
}

/**
 * Runtime token store: static seed tokens (first-party service credentials)
 * first, then the instance token, then `api_keys` by hash on the metered
 * archive. Every DB-backed key resolves to the single metered `free` tier,
 * except a first-party `internal` key; legacy paid pins on `api_keys.tier`
 * are not honored.
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
			// OSS only: the instance's own token authenticates every plane. A
			// self-hosted instance has one credential (bare hex from
			// `secondlayer init`), not a per-product `sk-sl_` key, so it must
			// be resolved before the prefix guard below. On platform, hex must
			// not authenticate hosted `/v1` as unmetered `internal`.
			if (!isPlatformMode() && instanceTokenMatches(rawToken)) {
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
				api_key_id: key.id,
				scopes: [opts.requiredScope],
			} as unknown as TTenant;
		},
	};
}
