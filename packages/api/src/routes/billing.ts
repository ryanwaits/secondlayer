/**
 * Billing routes — session-authed entry points for upgrade + portal.
 *
 *   POST /api/billing/upgrade   body: { tier: "launch" | "grow" | "scale" }
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
	getCaps,
	upsertCaps,
} from "@secondlayer/shared/db/queries/account-spend-caps";
import {
	getAccountById,
	setAccountPlan,
	setStripeCustomerId,
} from "@secondlayer/shared/db/queries/accounts";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { getStripe } from "../lib/stripe.ts";
import {
	UPGRADEABLE_TIERS,
	getPriceIdForTier,
	getTierForPriceId,
	isUpgradeableTier,
} from "../lib/tier-mapping.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

function dashboardBaseUrl(): string {
	return process.env.DASHBOARD_URL ?? "https://secondlayer.tools";
}

app.post("/upgrade", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { tier?: unknown };

	if (typeof body.tier !== "string" || !isUpgradeableTier(body.tier)) {
		return c.json(
			{
				error: `tier must be one of ${UPGRADEABLE_TIERS.join(", ")}. Enterprise subscriptions are custom-quoted — contact sales.`,
			},
			400,
		);
	}

	const priceId = getPriceIdForTier(body.tier);
	if (!priceId) {
		logger.error("Upgrade attempted without configured price id", {
			tier: body.tier,
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

	// Stripe-hosted redirects bypass our Next middleware, so the return
	// URLs must use the raw filesystem path (/platform/billing) rather
	// than the clean URL (/billing) that only works through the middleware
	// rewrite when navigated client-side.
	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: stripeCustomerId,
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${dashboardBaseUrl()}/platform/billing?upgrade=success`,
		cancel_url: `${dashboardBaseUrl()}/platform/billing?upgrade=cancelled`,
		subscription_data: {
			metadata: { secondlayer_account_id: account.id, tier: body.tier },
		},
	});

	return c.json({ url: session.url });
});

/**
 * POST /api/billing/resolve
 *
 * Called by the billing page's "fast-resolve" after a successful Checkout
 * redirect. Does a one-shot Stripe read of the customer's active
 * subscription, reverse-looks up the tier, writes `accounts.plan` if
 * different, returns the resolved plan.
 *
 * Eliminates the webhook race on the happy path — if Stripe hasn't fired
 * `customer.subscription.created` by the time the user lands on the
 * success URL, we catch up synchronously.
 *
 * Returns 200 always (even when nothing resolved): `{plan, resolved}`.
 * Caller falls back to whatever `accounts.plan` already was.
 */
app.post("/resolve", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	if (!account.stripe_customer_id) {
		return c.json({ plan: account.plan, resolved: false });
	}

	try {
		const stripe = getStripe();
		const subs = await stripe.subscriptions.list({
			customer: account.stripe_customer_id,
			status: "active",
			limit: 1,
		});
		const sub = subs.data[0];
		if (!sub) return c.json({ plan: account.plan, resolved: false });

		const priceId = sub.items.data[0]?.price.id;
		if (!priceId) return c.json({ plan: account.plan, resolved: false });

		const tier = getTierForPriceId(priceId);
		if (!tier) return c.json({ plan: account.plan, resolved: false });

		if (account.plan !== tier) {
			await setAccountPlan(db, account.id, tier);
			logger.info("billing.resolve.plan_updated", {
				accountId: account.id,
				from: account.plan,
				to: tier,
			});
		}

		return c.json({ plan: tier, resolved: true });
	} catch (err) {
		logger.warn("billing.resolve.stripe_failed", {
			accountId: account.id,
			error: err instanceof Error ? err.message : String(err),
		});
		return c.json({ plan: account.plan, resolved: false });
	}
});

app.get("/caps", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const caps = await getCaps(getDb(), accountId);
	return c.json({
		monthlyCapCents: caps?.monthly_cap_cents ?? null,
		computeCapCents: caps?.compute_cap_cents ?? null,
		storageCapCents: caps?.storage_cap_cents ?? null,
		aiCapCents: caps?.ai_cap_cents ?? null,
		alertThresholdPct: caps?.alert_threshold_pct ?? 80,
		frozenAt: caps?.frozen_at ?? null,
		alertSentAt: caps?.alert_sent_at ?? null,
	});
});

app.patch("/caps", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as {
		monthlyCapCents?: number | null;
		computeCapCents?: number | null;
		storageCapCents?: number | null;
		aiCapCents?: number | null;
		alertThresholdPct?: number;
	};

	// Normalize the input. Callers send cents directly; null explicitly
	// clears a cap.
	const patch: Parameters<typeof upsertCaps>[2] = {};
	if (body.monthlyCapCents !== undefined)
		patch.monthly_cap_cents = body.monthlyCapCents;
	if (body.computeCapCents !== undefined)
		patch.compute_cap_cents = body.computeCapCents;
	if (body.storageCapCents !== undefined)
		patch.storage_cap_cents = body.storageCapCents;
	if (body.aiCapCents !== undefined) patch.ai_cap_cents = body.aiCapCents;
	if (body.alertThresholdPct !== undefined) {
		if (body.alertThresholdPct < 1 || body.alertThresholdPct > 100) {
			return c.json(
				{ error: "alertThresholdPct must be between 1 and 100" },
				400,
			);
		}
		patch.alert_threshold_pct = body.alertThresholdPct;
	}

	// Raising the cap mid-cycle unfreezes the account — user explicitly
	// said "yes, bill more." Lowering it doesn't auto-freeze; the alert
	// cron will re-check and freeze if the new cap is already exceeded.
	const existing = await getCaps(getDb(), accountId);
	if (
		existing?.frozen_at &&
		patch.monthly_cap_cents != null &&
		existing.monthly_cap_cents != null &&
		patch.monthly_cap_cents > existing.monthly_cap_cents
	) {
		patch.frozen_at = null;
		patch.alert_sent_at = null;
	}

	const updated = await upsertCaps(getDb(), accountId, patch);
	return c.json({
		monthlyCapCents: updated.monthly_cap_cents,
		computeCapCents: updated.compute_cap_cents,
		storageCapCents: updated.storage_cap_cents,
		aiCapCents: updated.ai_cap_cents,
		alertThresholdPct: updated.alert_threshold_pct,
		frozenAt: updated.frozen_at,
		alertSentAt: updated.alert_sent_at,
	});
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
		return_url: `${dashboardBaseUrl()}/platform/billing`,
	});

	return c.json({ url: session.url });
});

export default app;
