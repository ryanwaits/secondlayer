import {
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import {
	INDEX_INTERNAL_TENANT_ID,
	defaultInternalIndexApiKey,
} from "@secondlayer/shared/index-internal-auth";
import type { MiddlewareHandler } from "hono";
import { createApiKeyTokenStore } from "../auth/api-key-store.ts";
import {
	allowsAnonymousRead,
	bearerToken,
	invalidCredentialError,
	missingCredentialError,
} from "../auth/read-plane.ts";
import type { IndexTier } from "./tiers.ts";
import type { IndexTip } from "./tip.ts";

export const INDEX_READ_SCOPE = "index:read";

export type IndexTenant = {
	tenant_id: string;
	account_id?: string;
	tier: IndexTier;
	scopes: readonly string[];
};

export type IndexEnv = {
	Variables: {
		indexTenant?: IndexTenant;
		indexTip: IndexTip;
		/** Set by the credits gate when a free account is on pay-as-you-go:
		 *  bypasses the free window + rate limit, debited per row read. */
		credited?: { accountId: string; balance: bigint };
	};
};

export type IndexTokenStore = {
	get(
		rawToken: string,
	): IndexTenant | undefined | Promise<IndexTenant | undefined>;
};

// Static seed tokens cover post-deploy smoke and test fixtures; production
// customer traffic resolves via createApiKeyTokenStore (api_keys.tier).
export const DEFAULT_INDEX_TOKENS: IndexTokenStore = new Map([
	[
		"sk-sl_index_free_test",
		{
			tenant_id: "tenant_index_free",
			tier: "free",
			scopes: [INDEX_READ_SCOPE],
		},
	],
	[
		"sk-sl_index_wrong_scope_test",
		{
			tenant_id: "tenant_index_wrong_scope",
			tier: "free",
			scopes: [],
		},
	],
]);

// First-party internal consumer (subgraph processor PublicApiBlockSource).
// Internal tier + NO account_id → reads are unmetered (metering gates on
// account_id). Key resolves from INDEX_INTERNAL_API_KEY env. Mirrors the
// Streams internal tenant seed.
(DEFAULT_INDEX_TOKENS as unknown as Map<string, IndexTenant>).set(
	defaultInternalIndexApiKey(),
	{
		tenant_id: INDEX_INTERNAL_TENANT_ID,
		tier: "internal",
		scopes: [INDEX_READ_SCOPE],
	},
);

export const DEFAULT_INDEX_TOKEN_STORE: IndexTokenStore =
	createApiKeyTokenStore({
		staticTokens: DEFAULT_INDEX_TOKENS,
		requiredScope: INDEX_READ_SCOPE,
		product: "index",
	});

export function indexBearerAuth(opts?: {
	tokens?: IndexTokenStore;
	requiredScope?: string;
	/** Override the read-plane policy (`allowsAnonymousRead`). Tests pin it;
	 *  routes should let the policy decide. */
	allowAnon?: boolean;
}): MiddlewareHandler<IndexEnv> {
	const tokens = opts?.tokens ?? DEFAULT_INDEX_TOKEN_STORE;
	const requiredScope = opts?.requiredScope ?? INDEX_READ_SCOPE;

	return async (c, next) => {
		// Same rule as Streams and subgraphs: open on a loopback bind, instance
		// token past it. The metered archive keeps its open anon reads.
		const allowAnon = opts?.allowAnon ?? allowsAnonymousRead();
		const apiKeyHeader = c.req.header("x-api-key");
		const rawToken = bearerToken(c);

		if (rawToken === null) {
			if (allowAnon) {
				await next();
				return;
			}
			// X-API-Key is never a credential here; say so rather than leaving
			// the caller to guess why their key did nothing.
			throw apiKeyHeader
				? new AuthenticationError(
						"Use Authorization: Bearer <key>, not X-API-Key",
						{
							hint: "Send the instance token as `Authorization: Bearer $INSTANCE_TOKEN`.",
							env_var: "INSTANCE_TOKEN",
						},
					)
				: missingCredentialError();
		}

		const tenant = await tokens.get(rawToken);
		if (!tenant) {
			// A credential we don't recognize is never fatal where anonymous
			// access already works — presenting a key must not turn a 200 into
			// a 401. It just buys nothing.
			if (allowAnon) {
				await next();
				return;
			}
			throw invalidCredentialError();
		}

		if (!tenant.scopes.includes(requiredScope)) {
			throw new AuthorizationError(`Missing required scope: ${requiredScope}`);
		}

		// Free keyed reads are allowed at the free-tier rate limit — a minted
		// key must never be slower than anonymous access.
		c.set("indexTenant", tenant);
		await next();
	};
}
