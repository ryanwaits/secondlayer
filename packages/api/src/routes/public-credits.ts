/**
 * Guest archive-credit checkout. No session — email is the identity.
 *
 *   POST /api/public/credits/checkout  { email, amount }
 *   GET  /api/public/credits/packs
 *
 * Mounted only in platform mode, outside PLATFORM_PATHS. Card charge lands
 * via checkout.session.completed (same as session-authed /api/billing/topup).
 */

import { upsertAccount } from "@secondlayer/platform/db/queries/accounts";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
import { getStripeOrNull } from "../lib/stripe.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { findUnusedClaimToken } from "../play/tokens.ts";
import {
	CREDIT_PACKS_USD,
	createCreditsCheckoutSession,
	isCreditPack,
} from "./billing.ts";

const app = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dashboardBaseUrl(): string {
	return process.env.DASHBOARD_URL ?? "https://secondlayer.tools";
}

app.get("/packs", (c) => c.json({ packs: CREDIT_PACKS_USD }));

app.post("/checkout", async (c) => {
	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { email?: unknown; amount?: unknown; claim_token?: unknown };

	const email =
		typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	if (!EMAIL_RE.test(email)) {
		return c.json({ error: "email must be a valid address" }, 400);
	}

	const usd =
		typeof body.amount === "number" ? body.amount : Number(body.amount);
	if (!isCreditPack(usd)) {
		return c.json(
			{ error: `amount must be one of ${CREDIT_PACKS_USD.join(", ")} (USD)` },
			400,
		);
	}

	const db = getDb();
	let claimTokenHash: string | undefined;
	let claimRaw: string | undefined;
	if (body.claim_token !== undefined) {
		if (typeof body.claim_token !== "string" || body.claim_token.length === 0) {
			return c.json({ error: "invalid_claim_token" }, 400);
		}
		claimRaw = body.claim_token;
		claimTokenHash = hashToken(claimRaw);
		const row = await findUnusedClaimToken(db, claimTokenHash);
		if (!row) {
			return c.json({ error: "invalid_claim_token" }, 400);
		}
	}

	const stripe = getStripeOrNull();
	if (!stripe) {
		logger.info("Guest credits checkout called but Stripe not configured");
		return c.json({ error: "billing_not_configured" }, 503);
	}

	const account = await upsertAccount(db, email);
	const url = await createCreditsCheckoutSession({
		stripe,
		db,
		account,
		usd,
		successUrl: claimRaw
			? `${dashboardBaseUrl()}/claim/${claimRaw}?paid=1`
			: `${dashboardBaseUrl()}/archive?topup=success`,
		cancelUrl: claimRaw
			? `${dashboardBaseUrl()}/claim/${claimRaw}?paid=0`
			: `${dashboardBaseUrl()}/archive?topup=cancelled`,
		...(claimTokenHash
			? { metadata: { claim_token_hash: claimTokenHash } }
			: {}),
	});
	if (!url) return c.json({ error: "checkout_failed" }, 502);
	return c.json({ url });
});

export default app;
