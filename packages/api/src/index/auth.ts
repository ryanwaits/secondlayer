import {
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import type { IndexTier } from "./tiers.ts";
import type { IndexTip } from "./tip.ts";

export const INDEX_READ_SCOPE = "index:read";

export type IndexTenant = {
	tenant_id: string;
	tier: IndexTier;
	scopes: readonly string[];
};

export type IndexEnv = {
	Variables: {
		indexTenant: IndexTenant;
		indexTip: IndexTip;
	};
};

export type IndexTokenStore = ReadonlyMap<string, IndexTenant>;

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

export function indexBearerAuth(opts?: {
	tokens?: IndexTokenStore;
	requiredScope?: string;
}): MiddlewareHandler<IndexEnv> {
	const tokens = opts?.tokens ?? DEFAULT_INDEX_TOKENS;
	const requiredScope = opts?.requiredScope ?? INDEX_READ_SCOPE;

	return async (c, next) => {
		const authHeader = c.req.header("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}

		const rawToken = authHeader.slice(7);
		const tenant = tokens.get(rawToken);
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
