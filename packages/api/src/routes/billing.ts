/**
 * Billing routes — session-authed entry points for upgrade + portal.
 *
 *   POST /api/billing/upgrade   body: { tier: "pro" }
 *     Returns a Stripe Checkout Session URL. Lazy-creates the Stripe
 *     customer if this account has never upgraded before.
 *
 *   GET  /api/billing/portal
 *     Returns a Stripe Billing Portal URL so the customer can update
 *     their card, download invoices, or cancel.
 *
 * Both are session-authed upstream via `requireAuth`.
 */

import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	getAccountById,
	setStripeCustomerId,
} from "@secondlayer/shared/db/queries/accounts";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { getStripe } from "../lib/stripe.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

// Tier → price env var. Enterprise is custom-quoted, no self-serve path.
const TIER_PRICE_ENV: Record<string, string> = {
	pro: "STRIPE_PRICE_PRO",
};

function dashboardBaseUrl(): string {
	return process.env.DASHBOARD_URL ?? "https://secondlayer.tools";
}

app.post("/upgrade", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { tier?: unknown };

	if (typeof body.tier !== "string" || !(body.tier in TIER_PRICE_ENV)) {
		return c.json(
			{
				error:
					"tier must be 'pro'. Enterprise subscriptions are custom-quoted — contact sales.",
			},
			400,
		);
	}

	const priceEnvVar = TIER_PRICE_ENV[body.tier];
	const priceId = process.env[priceEnvVar];
	if (!priceId) {
		logger.error("Upgrade attempted without configured price id", {
			tier: body.tier,
			envVar: priceEnvVar,
		});
		return c.json(
			{ error: "Billing is not fully configured yet. Contact support." },
			503,
		);
	}

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	const stripe = getStripe();

	// Lazy customer creation — first upgrade materializes the Stripe
	// Customer and persists the id. Returning users already have one.
	let stripeCustomerId = account.stripe_customer_id;
	if (!stripeCustomerId) {
		const customer = await stripe.customers.create({
			email: account.email,
			metadata: { secondlayer_account_id: account.id },
		});
		stripeCustomerId = customer.id;
		await setStripeCustomerId(db, account.id, stripeCustomerId);
		logger.info("Created Stripe customer", {
			accountId: account.id,
			stripeCustomerId,
		});
	}

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: stripeCustomerId,
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${dashboardBaseUrl()}/settings?upgrade=success`,
		cancel_url: `${dashboardBaseUrl()}/settings?upgrade=cancelled`,
		subscription_data: {
			metadata: { secondlayer_account_id: account.id, tier: body.tier },
		},
	});

	return c.json({ url: session.url });
});

app.get("/portal", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	if (!account.stripe_customer_id) {
		return c.json(
			{ error: "No active subscription. Upgrade to access billing portal." },
			400,
		);
	}

	const stripe = getStripe();
	const session = await stripe.billingPortal.sessions.create({
		customer: account.stripe_customer_id,
		return_url: `${dashboardBaseUrl()}/settings`,
	});

	return c.json({ url: session.url });
});

export default app;
