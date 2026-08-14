/**
 * Hosted vs retained HTTP surface.
 *
 * OSS mounts only retained routes. Hosted prefixes 404.
 * Platform keeps both.
 */
export const HOSTED_ROUTE_FIXTURES = [
	{ method: "GET", path: "/api/accounts" },
	{ method: "GET", path: "/api/billing" },
	{ method: "GET", path: "/api/wallet" },
	{ method: "GET", path: "/api/insights" },
	{ method: "GET", path: "/api/projects" },
	{ method: "GET", path: "/api/tenants" },
	{ method: "GET", path: "/api/keys" },
	{ method: "GET", path: "/api/admin" },
	{ method: "POST", path: "/api/auth/login" },
	{ method: "POST", path: "/api/webhooks/stripe" },
	{ method: "POST", path: "/v1/api-keys" },
	{ method: "GET", path: "/x402/supported" },
	{ method: "GET", path: "/v1/x402/supported" },
	{ method: "GET", path: "/.well-known/x402" },
	{ method: "POST", path: "/v1/x402/deposit" },
	{ method: "GET", path: "/v1/x402/balance" },
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

export const HOSTED_OPENAPI_PATHS = [
	"/v1/x402/supported",
	"/v1/subgraphs/deploy-paid",
	"/v1/x402/deposit",
	"/v1/x402/balance",
] as const;
