import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { Hono } from "hono";
import { X402_PRICE_CATALOG } from "../x402/catalog.ts";
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
	}),
);

export default router;
