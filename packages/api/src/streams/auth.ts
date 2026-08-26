import { AuthorizationError } from "@secondlayer/shared/errors";
import {
	INTERNAL_STREAMS_TENANT_ID,
	defaultInternalStreamsApiKey,
} from "@secondlayer/shared/index-internal-auth";
import type { MiddlewareHandler } from "hono";
import { createApiKeyTokenStore } from "../auth/api-key-store.ts";
import {
	allowsAnonymousRead,
	bearerToken,
	invalidCredentialError,
	missingCredentialError,
} from "../auth/read-plane.ts";
import type { StreamsTier } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

export const STREAMS_READ_SCOPE = "streams:read";

export type StreamsTenant = {
	tenant_id: string;
	account_id?: string;
	tier: StreamsTier;
	scopes: readonly string[];
};

export type StreamsEnv = {
	Variables: {
		/** Unset on an anonymous loopback read — Streams has no tenant then. */
		streamsTenant?: StreamsTenant;
		streamsTip: StreamsTip;
		/** Set by the credits gate when a free account is on pay-as-you-go:
		 *  bypasses retention + rate limit, debited per row read. */
		credited?: { accountId: string; balance: bigint };
	};
};

export type StreamsTokenStore = {
	get(
		rawToken: string,
	): StreamsTenant | undefined | Promise<StreamsTenant | undefined>;
};

// Static seed tokens cover internal callers (the L2 decoder uses Streams
// to feed its own indexer), public-good evaluation, post-deploy smoke, and
// test fixtures. Production traffic from real customers resolves against
// api_keys via createApiKeyTokenStore (api_keys.tier). The `_status_public` token
// is publicly known and intentionally evaluated as the free tier.
export const DEFAULT_STREAMS_TOKENS: StreamsTokenStore = new Map([
	[
		"sk-sl_streams_free_test",
		{
			tenant_id: "tenant_streams_free",
			tier: "free",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
	[
		"sk-sl_streams_status_public",
		{
			tenant_id: "tenant_streams_status_public",
			tier: "free",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
	[
		"sk-sl_streams_wrong_scope_test",
		{
			tenant_id: "tenant_streams_wrong_scope",
			tier: "free",
			scopes: [],
		},
	],
]);

(DEFAULT_STREAMS_TOKENS as Map<string, StreamsTenant>).set(
	defaultInternalStreamsApiKey(),
	{
		tenant_id: INTERNAL_STREAMS_TENANT_ID,
		tier: "internal",
		scopes: [STREAMS_READ_SCOPE],
	},
);

export const DEFAULT_STREAMS_TOKEN_STORE: StreamsTokenStore =
	createApiKeyTokenStore({
		staticTokens: DEFAULT_STREAMS_TOKENS,
		requiredScope: STREAMS_READ_SCOPE,
		product: "streams",
	});

export function streamsBearerAuth(opts?: {
	tokens?: StreamsTokenStore;
	requiredScope?: string;
	/** Override the read-plane policy (`allowsAnonymousRead`). Tests pin it;
	 *  routes should let the policy decide. */
	allowAnon?: boolean;
}): MiddlewareHandler<StreamsEnv> {
	const tokens = opts?.tokens ?? DEFAULT_STREAMS_TOKEN_STORE;
	const requiredScope = opts?.requiredScope ?? STREAMS_READ_SCOPE;

	return async (c, next) => {
		// Same rule as Index and subgraphs: open on a loopback bind, instance
		// token past it. `platform: false` keeps the metered archive keyed.
		const allowAnon =
			opts?.allowAnon ?? allowsAnonymousRead({ platform: false });
		const rawToken = bearerToken(c);
		if (rawToken === null) {
			if (allowAnon) {
				await next();
				return;
			}
			throw missingCredentialError();
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

		c.set("streamsTenant", tenant);
		await next();
	};
}
