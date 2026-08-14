/**
 * Billing routes — session-authed entry points for upgrade + portal.
 *
 *   POST /api/billing/upgrade   body: { tier: "launch" | "scale", interval?: "month" | "year" }
 *     Returns a Stripe Checkout Session URL. Lazy-creates the Stripe
 *     customer if this account has never upgraded before.
 *
 *   GET  /api/billing/portal
 *     Returns a Stripe Billing Portal URL so the customer can update
 *     their card, download invoices, or cancel.
 *
 * Both are session-authed upstream via `requireAuth`.
 */

import {
	getCreditRefill,
	getCredits,
	getMonthlyCreditsSpend,
	setCreditRefill,
} from "@secondlayer/platform/db/queries/account-credits";
import {
	getCaps,
	upsertCaps,
} from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	getAccountById,
	setAccountPlan,
	setStripeCustomerId,
} from "@secondlayer/platform/db/queries/accounts";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { getStripeOrNull } from "../lib/stripe.ts";
import {
	type BillingInterval,
	UPGRADEABLE_TIERS,
	getPriceIdForTier,
	getTierForPriceId,
	isSelfServeTier,
	isUpgradeableTier,
} from "../lib/tier-mapping.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

/** Prepaid archive-credit packs (USD). Min $10 — card fees make sub-$10 lossy. */
export const CREDIT_PACKS_USD = [10, 25, 50, 100] as const;
export type CreditPackUsd = (typeof CREDIT_PACKS_USD)[number];

export function isCreditPack(n: number): n is CreditPackUsd {
	return (CREDIT_PACKS_USD as readonly number[]).includes(n);
}

function dashboardBaseUrl(): string {
	return process.env.DASHBOARD_URL ?? "https://secondlayer.tools";
}

export type StripeClient = NonNullable<ReturnType<typeof getStripeOrNull>>;
type AccountRow = NonNullable<Awaited<ReturnType<typeof getAccountById>>>;

/** Stripe's `resource_missing` 400 — the stored customer id no longer exists
 * under the active key (deleted, or minted under a different key, e.g. a
 * test-mode id left over after a test→live flip). */
export function isResourceMissing(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		(err as { code?: unknown }).code === "resource_missing"
	);
}

/**
 * Lazy Stripe customer — first billing action materializes + persists it.
 *
 * Also self-heals a stale stored id: if the column holds a customer the active
 * key can't resolve (Stripe 404s `retrieve`, or returns a deleted customer),
 * we mint a fresh one and overwrite the column. Guards the test→live key flip
 * footgun where pre-flip test-mode `cus_` ids would otherwise 400 every
 * downstream call forever.
 */
export async function ensureStripeCustomer(
	stripe: StripeClient,
	db: ReturnType<typeof getDb>,
	account: AccountRow,
): Promise<string> {
	const existing = account.stripe_customer_id;
	if (existing) {
		try {
			const customer = await stripe.customers.retrieve(existing);
			// A deleted customer resolves to `{ deleted: true }` rather than
			// throwing — treat it as missing and recreate.
			if (!("deleted" in customer && customer.deleted)) return existing;
		} catch (err) {
			if (!isResourceMissing(err)) throw err;
		}
		logger.warn("Recreating stale Stripe customer", {
			accountId: account.id,
			staleCustomerId: existing,
		});
	}
	const customer = await stripe.customers.create({
		// NULL for ghost accounts (unreachable here in practice — billing is
		// session-gated and ghosts can't log in until claimed).
		email: account.email ?? undefined,
		metadata: { secondlayer_account_id: account.id },
	});
	await setStripeCustomerId(db, account.id, customer.id);
	logger.info("Created Stripe customer", {
		accountId: account.id,
		stripeCustomerId: customer.id,
	});
	return customer.id;
}

export async function createCreditsCheckoutSession(opts: {
	stripe: StripeClient;
	db: ReturnType<typeof getDb>;
	account: AccountRow;
	usd: CreditPackUsd;
	successUrl: string;
	cancelUrl: string;
}): Promise<string | null> {
	const stripeCustomerId = await ensureStripeCustomer(
		opts.stripe,
		opts.db,
		opts.account,
	);
	const session = await opts.stripe.checkout.sessions.create({
		mode: "payment",
		customer: stripeCustomerId,
		line_items: [
			{
				price_data: {
					currency: "usd",
					unit_amount: opts.usd * 100,
					product_data: { name: `Secondlayer archive credits — $${opts.usd}` },
				},
				quantity: 1,
			},
		],
		success_url: opts.successUrl,
		cancel_url: opts.cancelUrl,
		metadata: {
			secondlayer_account_id: opts.account.id,
			kind: "credits_topup",
		},
		payment_intent_data: {
			setup_future_usage: "off_session",
			metadata: {
				secondlayer_account_id: opts.account.id,
				kind: "credits_topup",
			},
		},
	});
	return session.url;
}

app.post("/upgrade", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { tier?: unknown; interval?: unknown };

	if (typeof body.tier !== "string" || !isUpgradeableTier(body.tier)) {
		return c.json(
			{
				error: `tier must be one of ${UPGRADEABLE_TIERS.join(", ")}. Enterprise subscriptions are custom-quoted — contact sales.`,
			},
			400,
		);
	}

	// Currently launch + scale are self-serve; enterprise never reaches here
	// (rejected above by isUpgradeableTier). Kept as a guard for any future
	// upgradeable-but-not-self-serve tier.
	if (!isSelfServeTier(body.tier)) {
		return c.json(
			{
				error:
					"That plan is custom-quoted — contact sales at https://secondlayer.tools to set up a subscription.",
				code: "CONTACT_SALES",
			},
			400,
		);
	}

	const interval: BillingInterval = body.interval === "year" ? "year" : "month";
	const priceId = getPriceIdForTier(body.tier, interval);
	if (!priceId) {
		logger.error("Upgrade attempted without configured price id", {
			tier: body.tier,
			interval,
		});
		return c.json(
			{ error: "Billing is not fully configured yet. Contact support." },
			503,
		);
	}

	const stripe = getStripeOrNull();
	if (!stripe) {
		logger.info("Upgrade called but Stripe not configured");
		return c.json({ error: "billing_not_configured" }, 503);
	}

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	const stripeCustomerId = await ensureStripeCustomer(stripe, db, account);

	// Stripe-hosted redirects bypass our Next middleware, so the return
	// URLs must use the raw filesystem path (/platform/billing) rather
	// than the clean URL (/billing) that only works through the middleware
	// rewrite when navigated client-side.
	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: stripeCustomerId,
		payment_method_collection: "always",
		allow_promotion_codes: true,
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${dashboardBaseUrl()}/platform/billing?upgrade=success`,
		cancel_url: `${dashboardBaseUrl()}/platform/billing?upgrade=cancelled`,
		subscription_data: {
			trial_period_days: 14,
			metadata: {
				secondlayer_account_id: account.id,
				tier: body.tier,
				interval,
			},
		},
	});

	return c.json({ url: session.url });
});

/**
 * POST /api/billing/topup   body: { amount: 10 | 25 | 50 | 100 }
 *
 * One-time prepaid dev-credit top-up. Returns a Stripe Checkout Session URL in
 * `mode: "payment"` (not a subscription) with an inline price for the chosen
 * pack. The balance is credited by the `checkout.session.completed` webhook —
 * never here — so credit only lands on confirmed payment.
 */
app.post("/topup", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { amount?: unknown };

	const usd = typeof body.amount === "number" ? body.amount : Number.NaN;
	if (!isCreditPack(usd)) {
		return c.json(
			{ error: `amount must be one of ${CREDIT_PACKS_USD.join(", ")} (USD)` },
			400,
		);
	}

	const stripe = getStripeOrNull();
	if (!stripe) {
		logger.info("Topup called but Stripe not configured");
		return c.json({ error: "billing_not_configured" }, 503);
	}

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	const url = await createCreditsCheckoutSession({
		stripe,
		db,
		account,
		usd,
		successUrl: `${dashboardBaseUrl()}/platform/billing?topup=success`,
		cancelUrl: `${dashboardBaseUrl()}/platform/billing?topup=cancelled`,
	});
	return c.json({ url });
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
		const stripe = getStripeOrNull();
		if (!stripe) {
			return c.json({ plan: account.plan, resolved: false });
		}
		// status:"all" + explicit pick — a fresh trial checkout is `trialing`,
		// which a status:"active" filter silently misses (resolve would no-op
		// for every new trial signup and leave the plan to the webhook race).
		const subs = await stripe.subscriptions.list({
			customer: account.stripe_customer_id,
			status: "all",
			limit: 5,
		});
		const sub = subs.data.find(
			(s) => s.status === "active" || s.status === "trialing",
		);
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

/**
 * POST /api/billing/cancel
 *
 * In-app downgrade: schedule the live subscription to cancel at period end
 * (`cancel_at_period_end = true`). Keeps Pro through the paid-for window, then
 * Stripe fires `customer.subscription.deleted` and the webhook drops the plan
 * to Free — no proration, no immediate cutoff. Idempotent: a second call on an
 * already-ending sub is a no-op. The billing page reads `cancelAtPeriodEnd`
 * back as the "ending" state ("Resume Pro" re-opens it in the portal).
 */
app.post("/cancel", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);
	if (!account.stripe_customer_id) {
		return c.json({ error: "No active subscription to cancel." }, 400);
	}

	const stripe = getStripeOrNull();
	if (!stripe) {
		logger.info("Cancel called but Stripe not configured");
		return c.json({ error: "billing_not_configured" }, 503);
	}

	const subs = await stripe.subscriptions.list({
		customer: account.stripe_customer_id,
		status: "all",
		limit: 5,
	});
	const sub = subs.data.find(
		(s) => s.status === "active" || s.status === "trialing",
	);
	if (!sub) {
		return c.json({ error: "No active subscription to cancel." }, 400);
	}

	const toIso = (epoch: number | null | undefined) =>
		epoch ? new Date(epoch * 1000).toISOString() : null;

	if (sub.cancel_at_period_end) {
		return c.json({ cancelAtPeriodEnd: true, cancelAt: toIso(sub.cancel_at) });
	}

	const updated = await stripe.subscriptions.update(sub.id, {
		cancel_at_period_end: true,
	});
	logger.info("billing.cancel.scheduled", {
		accountId: account.id,
		subscriptionId: sub.id,
	});
	return c.json({
		cancelAtPeriodEnd: true,
		cancelAt: toIso(updated.cancel_at),
	});
});

/**
 * GET /api/billing/status
 *
 * Read-only snapshot of an account's billing state — plan from the DB
 * plus the latest Stripe subscription (status, trial end, current period
 * end, discount). Lets a customer verify post-checkout that the webhook
 * landed and the gate has cleared, without having to retry `sl instance
 * create` blindly.
 *
 * Falls back to DB-only response when Stripe is unconfigured or the
 * customer has never upgraded. Stripe read failures degrade to DB-only
 * rather than 500ing — billing introspection should never block.
 */
app.get("/status", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	const refill = await getCreditRefill(db, accountId);
	const base = {
		plan: account.plan,
		stripeCustomerId: account.stripe_customer_id ?? null,
		creditsUsdMicros: (await getCredits(db, accountId)).toString(),
		// Real PAYG draw-down this month (reads beyond the free window). Display-
		// only on the billing page; never folds into the subscription invoice.
		creditsSpentThisMonthUsdMicros: (
			await getMonthlyCreditsSpend(db, accountId)
		).toString(),
		refill: {
			belowUsd:
				refill.belowUsdMicros != null
					? Number(refill.belowUsdMicros) / 1_000_000
					: null,
			packUsd: refill.packUsd,
			lastAt: refill.lastAt?.toISOString() ?? null,
		},
	};

	if (!account.stripe_customer_id) {
		return c.json({ ...base, subscription: null });
	}

	const stripe = getStripeOrNull();
	if (!stripe) return c.json({ ...base, subscription: null });

	try {
		const subs = await stripe.subscriptions.list({
			customer: account.stripe_customer_id,
			status: "all",
			limit: 5,
			expand: ["data.discounts.source.coupon", "data.discounts.promotion_code"],
		});
		// Prefer the live one (active/trialing); fall back to most recent so
		// canceled accounts still see history rather than `null`.
		const sub =
			subs.data.find((s) => s.status === "active" || s.status === "trialing") ??
			subs.data[0];
		if (!sub) return c.json({ ...base, subscription: null });

		const item = sub.items.data[0];
		const priceId = item?.price.id ?? null;
		const tier = priceId ? getTierForPriceId(priceId) : null;
		const interval = item?.price.recurring?.interval ?? null;
		const amountCents = item?.price.unit_amount ?? null;
		const toIso = (epoch: number | null | undefined) =>
			epoch ? new Date(epoch * 1000).toISOString() : null;

		// Stripe returns `discounts` as `Array<string | Discount>`. With
		// `expand[]=data.discounts.source.coupon` the Discount is hydrated
		// and `source.coupon` is the full Coupon. Walk both narrows.
		const firstDiscount = sub.discounts?.find(
			(d): d is Exclude<typeof d, string> => typeof d !== "string",
		);
		const coupon =
			firstDiscount && typeof firstDiscount.source.coupon !== "string"
				? firstDiscount.source.coupon
				: null;
		const promoCode =
			firstDiscount && typeof firstDiscount.promotion_code !== "string"
				? (firstDiscount.promotion_code?.code ?? null)
				: null;
		const discount = coupon
			? {
					name: coupon.name ?? null,
					code: promoCode,
					percentOff: coupon.percent_off ?? null,
					amountOff: coupon.amount_off ?? null,
					duration: coupon.duration,
				}
			: null;

		// `current_period_end` lives on the subscription in older API
		// versions and on each item in newer ones — read both.
		const currentPeriodEnd =
			(sub as unknown as { current_period_end?: number }).current_period_end ??
			(item as unknown as { current_period_end?: number } | undefined)
				?.current_period_end ??
			null;

		return c.json({
			...base,
			subscription: {
				id: sub.id,
				status: sub.status,
				tier,
				interval,
				amountCents,
				trialEnd: toIso(sub.trial_end),
				currentPeriodEnd: toIso(currentPeriodEnd),
				cancelAt: toIso(sub.cancel_at),
				cancelAtPeriodEnd: sub.cancel_at_period_end,
				discount,
			},
		});
	} catch (err) {
		logger.warn("billing.status.stripe_failed", {
			accountId,
			error: err instanceof Error ? err.message : String(err),
		});
		return c.json({ ...base, subscription: null });
	}
});

/**
 * POST /api/billing/refill
 *   { belowUsd: number | null, packUsd?: 10|25|50|100 }
 *
 * Opt-in auto-refill. Default is off (`belowUsd: null`). Requires a saved
 * card from a prior checkout (`setup_future_usage: off_session`).
 */
app.post("/refill", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { belowUsd?: unknown; packUsd?: unknown };

	if (body.belowUsd === null) {
		const refill = await setCreditRefill(getDb(), accountId, {
			belowUsdMicros: null,
			packUsd: null,
		});
		return c.json({
			belowUsd: null,
			packUsd: null,
			lastAt: refill.lastAt?.toISOString() ?? null,
		});
	}

	const belowUsd =
		typeof body.belowUsd === "number" ? body.belowUsd : Number(body.belowUsd);
	if (!Number.isFinite(belowUsd) || belowUsd < 1) {
		return c.json({ error: "belowUsd must be at least 1" }, 400);
	}

	const packRaw =
		typeof body.packUsd === "number"
			? body.packUsd
			: Number(body.packUsd ?? 25);
	if (!isCreditPack(packRaw)) {
		return c.json(
			{ error: `packUsd must be one of ${CREDIT_PACKS_USD.join(", ")}` },
			400,
		);
	}

	const refill = await setCreditRefill(getDb(), accountId, {
		belowUsdMicros: BigInt(Math.round(belowUsd * 1_000_000)),
		packUsd: packRaw,
	});
	return c.json({
		belowUsd,
		packUsd: packRaw,
		lastAt: refill.lastAt?.toISOString() ?? null,
	});
});

app.get("/caps", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const caps = await getCaps(getDb(), accountId);
	return c.json({
		monthlyCapCents: caps?.monthly_cap_cents ?? null,
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
		alertThresholdPct?: number;
	};

	// Normalize the input. Callers send cents directly; null explicitly
	// clears a cap.
	const patch: Parameters<typeof upsertCaps>[2] = {};
	if (body.monthlyCapCents !== undefined)
		patch.monthly_cap_cents = body.monthlyCapCents;
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
			{ error: "No billing customer yet. Buy credits first." },
			400,
		);
	}

	const stripe = getStripeOrNull();
	if (!stripe) {
		logger.info("Portal called but Stripe not configured");
		return c.json({ error: "billing_not_configured" }, 503);
	}
	// Validate/self-heal the stored id before opening the portal — a stale
	// (e.g. test-mode) customer would otherwise surface a raw Stripe 400 here,
	// the one billing path with no graceful degrade.
	const customerId = await ensureStripeCustomer(stripe, db, account);
	const session = await stripe.billingPortal.sessions.create({
		customer: customerId,
		return_url: `${dashboardBaseUrl()}/platform/billing`,
	});

	return c.json({ url: session.url });
});

export default app;
