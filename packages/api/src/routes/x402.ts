import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { Hono } from "hono";
import { X402_MIN_FLOOR_USD, X402_PRICE_CATALOG } from "../x402/catalog.ts";
import { isX402Enabled } from "../x402/facilitator.ts";

/**
 * Self-hosted x402 capability advertisement (`GET /x402/supported`). Lets our
 * SDK/MCP — and any off-the-shelf x402 agent — discover the supported scheme,
 * network, priced surfaces, and accepted assets at runtime, without importing the
 * API-local catalog. No external Bazaar registration.
 */
const router = new Hono();

router.get("/supported", (c) =>
	c.json({
		x402Version: 2,
		enabled: isX402Enabled(),
		kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK.mainnet }],
		catalog: X402_PRICE_CATALOG,
		assets: X402_TOKENS,
		floorUsd: X402_MIN_FLOOR_USD,
		paymentHeader: "PAYMENT-SIGNATURE",
		receiptHeader: "PAYMENT-RESPONSE",
		// Advisory metadata so agents can budget before calling.
		freeQuota: { index: { limit: 1000, window: "1d", per: "ip" } },
		sessions: {
			streams: { header: "PAYMENT-SESSION", maxCalls: 500, ttlSeconds: 3600 },
		},
		paidWrites: {
			"subgraph-deploy": "POST /v1/subgraphs",
			"subgraph-renew": "POST /v1/subgraphs/{name}/renew",
		},
		docs: "https://secondlayer.tools/pricing#pay-per-call",
	}),
);

export default router;
