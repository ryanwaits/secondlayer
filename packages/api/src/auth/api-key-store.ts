import {
	OAUTH_ACCESS_PREFIX,
	resolveOauthAccessToken,
} from "@secondlayer/platform/db/queries/oauth";
import {
	type ApiKeyStatus,
	getDb as defaultGetDb,
} from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { instanceTokenMatches } from "../instance-bind.ts";
import { isKeyLive } from "./key-state.ts";
import { hashToken } from "./keys.ts";
import { isMcpRequest } from "./oauth/audience.ts";
import { INSTANCE_TENANT_ID } from "./read-plane.ts";

export type ProductTier = "free" | "internal";

export type ProductTenant<TTier extends ProductTier = ProductTier> = {
	tenant_id: string;
	account_id?: string;
	tier: TTier;
	api_key_id?: string;
	grant_id?: string;
	scopes: readonly string[];
};

export type ProductTokenStore<TTenant> = {
	get(
		rawToken: string,
		req?: Request,
	): TTenant | undefined | Promise<TTenant | undefined>;
};

export type RevokedAccountKey = { id: string; account_id: string };

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
	status: ApiKeyStatus;
	expires_at?: Date | null;
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
	const row = await db
		.selectFrom("api_keys")
		.select(["id", "account_id", "status", "expires_at", "tier"])
		.where("key_hash", "=", tokenHash)
		.where("product", "in", acceptedKeyProducts(product))
		.executeTakeFirst();

	if (!row) return null;
	return {
		id: row.id,
		account_id: row.account_id,
		status: row.status,
		expires_at: row.expires_at,
		tier: row.tier === "internal" ? "internal" : "free",
	};
}

/**
 * An OAuth access token's tenant: hosted only, Index and Streams only, and
 * only on a request the hosted MCP handler made. Anywhere else it is unknown,
 * never a fall-through to sessions or keys. Metered like an account key, with
 * no key id.
 */
async function resolveOauthTenant<TTenant extends ProductTenant>(
	rawToken: string,
	req: Request | undefined,
	opts: ApiKeyTokenStoreOptions<TTenant>,
	getDb: typeof defaultGetDb,
): Promise<TTenant | undefined> {
	if (!isPlatformMode() || !isMcpRequest(req)) return undefined;
	if (opts.product !== "index" && opts.product !== "streams") return undefined;
	const grant = await resolveOauthAccessToken(getDb(), rawToken);
	if (!grant) return undefined;
	return {
		tenant_id: `account:${grant.accountId}`,
		account_id: grant.accountId,
		tier: "free",
		grant_id: grant.grantId,
		scopes: [opts.requiredScope],
	} as unknown as TTenant;
}

export function createApiKeyTokenStore<TTenant extends ProductTenant>(
	opts: ApiKeyTokenStoreOptions<TTenant>,
): ProductTokenStore<TTenant> {
	const getDb = opts.getDb ?? defaultGetDb;
	const lookupApiKey = opts.lookupApiKey ?? lookupAccountApiKey;

	return {
		async get(rawToken: string, req?: Request): Promise<TTenant | undefined> {
			if (rawToken.startsWith(OAUTH_ACCESS_PREFIX)) {
				return resolveOauthTenant<TTenant>(rawToken, req, opts, getDb);
			}
			// Seeds live in the public repo (dev, test and smoke fixtures), so
			// on platform only a first-party `internal` seed may authenticate.
			const seeded = await opts.staticTokens.get(rawToken);
			if (seeded && (!isPlatformMode() || seeded.tier === "internal")) {
				return seeded;
			}
			// OSS only: the instance's own token authenticates every plane. A
			// self-hosted instance has one credential (bare hex from
			// `secondlayer init`), not a per-product `sk-sl_` key, so it must
			// be resolved before the prefix guard below. On platform, hex must
			// not authenticate hosted `/v1` as unmetered `internal`.
			if (!isPlatformMode() && instanceTokenMatches(rawToken)) {
				return {
					tenant_id: INSTANCE_TENANT_ID,
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
			if (!key || !isKeyLive(key)) return undefined;

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
