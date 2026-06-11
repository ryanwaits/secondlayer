import { getDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { Hono } from "hono";
import {
	MAX_DEPOSIT_USD,
	MIN_DEPOSIT_USD,
	creditBalance,
	getBalance,
	mintBalanceToken,
	usdToMicros,
	verifyBalanceToken,
} from "../x402/balance.ts";
import { X402_MIN_FLOOR_USD, X402_PRICE_CATALOG } from "../x402/catalog.ts";
import { isX402Enabled } from "../x402/facilitator.ts";
import { x402PaymentRequired } from "../x402/middleware.ts";
import { getSessionSecret } from "../x402/session.ts";

/**
 * Self-hosted x402 capability advertisement (`GET /x402/supported`). Lets our
 * SDK/MCP — and any off-the-shelf x402 agent — discover the supported scheme,
 * network, priced surfaces, and accepted assets at runtime, without importing the
 * API-local catalog. No external Bazaar registration.
 *
 * Also hosts the prepaid-credit surfaces:
 *   POST /deposit?usd=N  — pay once on-chain (confirmed tier), credit a tab,
 *                          get back a long-lived PAYMENT-BALANCE token.
 *   GET  /balance        — current tab, authenticated by that token.
 */

type X402RouterDeps = {
	depositMiddleware?: ReturnType<typeof x402PaymentRequired>;
};

export function createX402Router(deps: X402RouterDeps = {}) {
	const router = new Hono();

	router.get("/supported", (c) =>
		c.json({
			x402Version: 2,
			enabled: isX402Enabled(),
			kinds: [
				{ x402Version: 2, scheme: "exact", network: X402_NETWORK.mainnet },
			],
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
			prepaid: {
				deposit: "POST /v1/x402/deposit?usd=<amount>",
				balance: "GET /v1/x402/balance",
				header: "PAYMENT-BALANCE",
				minUsd: MIN_DEPOSIT_USD,
				maxUsd: MAX_DEPOSIT_USD,
			},
			docs: "https://secondlayer.tools/pricing#pay-per-call",
		}),
	);

	const readUsd = (c: { req: { query(name: string): string | undefined } }) => {
		const raw = Number(c.req.query("usd") ?? MIN_DEPOSIT_USD);
		if (!Number.isFinite(raw) || raw < MIN_DEPOSIT_USD) {
			throw new ValidationError(`Deposit must be at least $${MIN_DEPOSIT_USD}`);
		}
		return Math.min(raw, MAX_DEPOSIT_USD);
	};

	if (deps.depositMiddleware || isX402Enabled()) {
		const depositMw =
			deps.depositMiddleware ??
			x402PaymentRequired({
				surface: "deposit",
				ledgerKind: "deposit",
				priceUsdOverride: readUsd,
			});
		router.post("/deposit", depositMw, async (c) => {
			const payer = c.get("x402Payer" as never) as string | undefined;
			const paidUsd = c.get("x402PaidUsd" as never) as number | undefined;
			if (!payer || !paidUsd) {
				throw new ValidationError("Deposit requires a settled payment");
			}
			const secret = getSessionSecret();
			if (!secret) {
				return c.json(
					{
						error: "Prepaid balances are not configured on this host",
						code: "PAYMENT_RAIL_UNAVAILABLE",
					},
					503,
				);
			}
			const balance = await creditBalance(getDb(), payer, usdToMicros(paidUsd));
			return c.json({
				credited_usd: paidUsd,
				balance_usd: Number(balance) / 1_000_000,
				balance_token: mintBalanceToken(payer, secret),
				balance_header: "PAYMENT-BALANCE",
			});
		});
	} else {
		router.post("/deposit", (c) =>
			c.json(
				{
					error: "x402 payment rail is not enabled on this host",
					code: "PAYMENT_RAIL_UNAVAILABLE",
				},
				503,
			),
		);
	}

	router.get("/balance", async (c) => {
		const token = c.req.header("PAYMENT-BALANCE");
		const principal = token ? verifyBalanceToken(token) : null;
		if (!principal) {
			return c.json(
				{
					error: "Missing or invalid PAYMENT-BALANCE token",
					code: "AUTHENTICATION_ERROR",
				},
				401,
			);
		}
		const balance = await getBalance(getDb(), principal);
		return c.json({
			principal,
			balance_usd: Number(balance) / 1_000_000,
		});
	});

	return router;
}

export default createX402Router();
