import {
	L2_INTERNAL_STREAMS_TENANT_ID,
	defaultInternalStreamsApiKey,
} from "@secondlayer/indexer/l2/internal-auth";
import {
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import { createRuntimeProductTokenStore } from "../auth/product-token-store.ts";
import type { MiddlewareHandler } from "hono";
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
		streamsTenant: StreamsTenant;
		streamsTip: StreamsTip;
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
// api_keys via createRuntimeProductTokenStore. The `_status_public` token
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
		"sk-sl_streams_build_test",
		{
			tenant_id: "tenant_streams_build",
			tier: "build",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
	[
		"sk-sl_streams_scale_test",
		{
			tenant_id: "tenant_streams_scale",
			tier: "scale",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
	[
		"sk-sl_streams_enterprise_test",
		{
			tenant_id: "tenant_streams_enterprise",
			tier: "enterprise",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
	[
		"sk-sl_streams_wrong_scope_test",
		{
			tenant_id: "tenant_streams_wrong_scope",
			tier: "build",
			scopes: [],
		},
	],
]);

(DEFAULT_STREAMS_TOKENS as Map<string, StreamsTenant>).set(
	defaultInternalStreamsApiKey(),
	{
		tenant_id: L2_INTERNAL_STREAMS_TENANT_ID,
		tier: "enterprise",
		scopes: [STREAMS_READ_SCOPE],
	},
);

export const DEFAULT_STREAMS_TOKEN_STORE: StreamsTokenStore =
	createRuntimeProductTokenStore({
		staticTokens: DEFAULT_STREAMS_TOKENS,
		requiredScope: STREAMS_READ_SCOPE,
		product: "streams",
	});

export function streamsBearerAuth(opts?: {
	tokens?: StreamsTokenStore;
	requiredScope?: string;
}): MiddlewareHandler<StreamsEnv> {
	const tokens = opts?.tokens ?? DEFAULT_STREAMS_TOKEN_STORE;
	const requiredScope = opts?.requiredScope ?? STREAMS_READ_SCOPE;

	return async (c, next) => {
		const authHeader = c.req.header("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}

		const rawToken = authHeader.slice(7);
		const tenant = await tokens.get(rawToken);
		if (!tenant) {
			throw new AuthenticationError("Invalid API key");
		}

		if (!tenant.scopes.includes(requiredScope)) {
			throw new AuthorizationError(`Missing required scope: ${requiredScope}`);
		}

		c.set("streamsTenant", tenant);
		await next();
	};
}
