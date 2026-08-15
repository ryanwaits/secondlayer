/**
 * Billing routes — the metered-archive credits surface. Session-authed
 * upstream via `requireAuth`.
 *
 *   GET   /api/billing/status   credits balance + refill config snapshot
 *   POST  /api/billing/topup    one-time prepaid credit pack → Stripe Checkout
 *   POST  /api/billing/refill   opt-in auto-refill threshold
 *   GET   /api/billing/caps     monthly spend cap + alert threshold
 *   PATCH /api/billing/caps
 *
 * Subscription plumbing (/upgrade, /resolve, /cancel, /portal and the
 * subscription half of /status) was removed with the plan/tier retirement —
 * credits are the only paid rail (gate-g-deletion-manifest.md §1).
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
	setStripeCustomerId,
} from "@secondlayer/platform/db/queries/accounts";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { getStripeOrNull } from "../lib/stripe.ts";
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
		successUrl: `${dashboardBaseUrl()}/archive?topup=success`,
		cancelUrl: `${dashboardBaseUrl()}/archive?topup=cancelled`,
	});
	return c.json({ url });
});

/**
 * GET /api/billing/status
 *
 * Read-only snapshot of the account's credits state — prepaid balance,
 * this month's PAYG draw-down, and the auto-refill config. Pure DB read;
 * never talks to Stripe, so it can never block or 500 on Stripe weather.
 *
 * `subscription` is always null — subscriptions were retired with plans;
 * the field is kept so existing clients (CLI `credits balance`) keep
 * parsing.
 */
app.get("/status", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);

	const refill = await getCreditRefill(db, accountId);
	return c.json({
		stripeCustomerId: account.stripe_customer_id ?? null,
		creditsUsdMicros: (await getCredits(db, accountId)).toString(),
		// Real PAYG draw-down this month (reads beyond the free window).
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
		subscription: null,
	});
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

export default app;
