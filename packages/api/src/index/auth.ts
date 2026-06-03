import {
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import {
	INDEX_INTERNAL_TENANT_ID,
	defaultInternalIndexApiKey,
} from "@secondlayer/shared/index-internal-auth";
import type { MiddlewareHandler } from "hono";
import { createRuntimeProductTokenStore } from "../auth/product-token-store.ts";
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
	};
};

export type IndexTokenStore = {
	get(
		rawToken: string,
	): IndexTenant | undefined | Promise<IndexTenant | undefined>;
};

// Static seed tokens cover post-deploy smoke and test fixtures; production
// customer traffic resolves via createRuntimeProductTokenStore (api_keys).
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
		"sk-sl_index_build_test",
		{
			tenant_id: "tenant_index_build",
			tier: "build",
			scopes: [INDEX_READ_SCOPE],
		},
	],
	[
		"sk-sl_index_scale_test",
		{
			tenant_id: "tenant_index_scale",
			tier: "scale",
			scopes: [INDEX_READ_SCOPE],
		},
	],
	[
		"sk-sl_index_enterprise_test",
		{
			tenant_id: "tenant_index_enterprise",
			tier: "enterprise",
			scopes: [INDEX_READ_SCOPE],
		},
	],
	[
		"sk-sl_index_wrong_scope_test",
		{
			tenant_id: "tenant_index_wrong_scope",
			tier: "build",
			scopes: [],
		},
	],
]);

// First-party internal consumer (subgraph processor PublicApiBlockSource).
// Enterprise tier + NO account_id → reads are unmetered (metering gates on
// account_id). Key resolves from INDEX_INTERNAL_API_KEY env. Mirrors the
// Streams internal tenant seed.
(DEFAULT_INDEX_TOKENS as unknown as Map<string, IndexTenant>).set(
	defaultInternalIndexApiKey(),
	{
		tenant_id: INDEX_INTERNAL_TENANT_ID,
		tier: "enterprise",
		scopes: [INDEX_READ_SCOPE],
	},
);

export const DEFAULT_INDEX_TOKEN_STORE: IndexTokenStore =
	createRuntimeProductTokenStore({
		staticTokens: DEFAULT_INDEX_TOKENS,
		requiredScope: INDEX_READ_SCOPE,
		product: "index",
	});

export function indexBearerAuth(opts?: {
	tokens?: IndexTokenStore;
	requiredScope?: string;
}): MiddlewareHandler<IndexEnv> {
	const tokens = opts?.tokens ?? DEFAULT_INDEX_TOKEN_STORE;
	const requiredScope = opts?.requiredScope ?? INDEX_READ_SCOPE;

	return async (c, next) => {
		const authHeader = c.req.header("authorization");
		const apiKeyHeader = c.req.header("x-api-key");

		// Reject x-api-key header explicitly so clients get a signal rather than
		// silently falling through to anon. Only Bearer is the supported format.
		if (!authHeader && apiKeyHeader) {
			throw new AuthenticationError(
				"Use Authorization: Bearer <key>, not X-API-Key",
			);
		}

		// Open-beta: no header = anon read. Keys still validated when presented so
		// metering + tier checks continue to work for paid-tier resurrection.
		if (!authHeader?.startsWith("Bearer ")) {
			await next();
			return;
		}

		const rawToken = authHeader.slice(7);
		const tenant = await tokens.get(rawToken);
		if (!tenant) {
			throw new AuthenticationError("Invalid API key");
		}

		if (!tenant.scopes.includes(requiredScope)) {
			throw new AuthorizationError(`Missing required scope: ${requiredScope}`);
		}

		if (tenant.tier === "free") {
			throw new AuthorizationError(
				"free tier can evaluate Stacks Index in docs only. Use Build or higher for API access",
			);
		}

		c.set("indexTenant", tenant);
		await next();
	};
}
