/**
 * Hosted vs retained HTTP surface.
 *
 * OSS mounts only retained routes. Hosted prefixes 404.
 * Platform keeps both.
 *
 * Four fixture classes:
 *  - HOSTED_ROUTE_FIXTURES — hosted-only surface. Empty since the x402
 *    pay-per-call rail was deleted; kept as a named seam so a future
 *    hosted-only route has somewhere to land.
 *  - DELETED_ROUTE_FIXTURES — hosted-control surface removed by gate-g
 *    Slice D, plus the x402 rail. Must 404 in EVERY mode, forever —
 *    reappearance is a regression.
 *  - RETAINED_METER_ROUTE_FIXTURES — the kept metered-archive account
 *    surface (gate-g manifest §1/§3). Mounted only in platform/archive
 *    mode, so it also 404s in oss, but it is NOT a deletion candidate —
 *    deletion scans must treat it as retained.
 *  - RETAINED_ROUTE_FIXTURES — mode-independent surface that stays up
 *    in oss.
 */
export const HOSTED_ROUTE_FIXTURES = [] as const;

/** Gate-g Slice D deletions + the x402 rail — 404 in oss and platform alike. */
export const DELETED_ROUTE_FIXTURES = [
	{ method: "GET", path: "/x402/supported" },
	{ method: "GET", path: "/v1/x402/supported" },
	{ method: "GET", path: "/.well-known/x402" },
	{ method: "POST", path: "/v1/x402/deposit" },
	{ method: "GET", path: "/v1/x402/balance" },
	{ method: "GET", path: "/api/wallet" },
	{ method: "GET", path: "/api/insights" },
	{ method: "GET", path: "/api/projects" },
	{ method: "GET", path: "/api/tenants" },
	{ method: "GET", path: "/api/admin" },
	{ method: "POST", path: "/v1/api-keys" },
	{ method: "GET", path: "/api/accounts/usage" },
	{ method: "GET", path: "/api/accounts/usage/products" },
	{ method: "GET", path: "/v1/index/usage" },
	{ method: "GET", path: "/v1/streams/usage" },
	{ method: "POST", path: "/api/auth/claim" },
	{ method: "POST", path: "/api/auth/claim/verify" },
] as const;

/** Kept meter surface (manifest §3): auth, credits billing, checkout,
 * Stripe webhook, key management, account profile. */
export const RETAINED_METER_ROUTE_FIXTURES = [
	{ method: "POST", path: "/api/auth/login" },
	{ method: "GET", path: "/api/billing/status" },
	{ method: "POST", path: "/api/billing/topup" },
	{ method: "POST", path: "/api/billing/refill" },
	{ method: "GET", path: "/api/billing/caps" },
	{ method: "POST", path: "/api/public/credits/checkout" },
	{ method: "POST", path: "/api/webhooks/stripe" },
	{ method: "GET", path: "/api/keys" },
	{ method: "GET", path: "/api/accounts/me" },
] as const;

export const RETAINED_ROUTE_FIXTURES = [
	{ method: "GET", path: "/health" },
	{ method: "GET", path: "/status" },
	{ method: "GET", path: "/v1" },
	{ method: "GET", path: "/v1/openapi.json" },
	{ method: "GET", path: "/v1/index" },
	{ method: "GET", path: "/v1/streams" },
	{ method: "GET", path: "/v1/subgraphs" },
	{ method: "GET", path: "/v1/contracts" },
	{ method: "GET", path: "/v1/instance" },
	{ method: "GET", path: "/v1/instance/features" },
	{ method: "GET", path: "/console" },
	{ method: "POST", path: "/v1/batch" },
	{ method: "GET", path: "/api/subgraphs" },
	{ method: "GET", path: "/api/subscriptions" },
	{ method: "GET", path: "/api/node" },
] as const;

export const HOSTED_OPENAPI_PATHS = [] as const;
