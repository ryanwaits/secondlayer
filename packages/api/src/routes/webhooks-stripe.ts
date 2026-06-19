/**
 * Stripe webhook endpoint.
 *
 * Signature is verified against STRIPE_WEBHOOK_SECRET — bodies that don't
 * verify are rejected 400 (Stripe will retry). Verified events are
 * audited; subscription lifecycle events write `accounts.plan`.
 *
 * Important: Hono's default body parser reads JSON, but Stripe signatures
 * are computed over the RAW bytes. We use `c.req.text()` then verify
 * with the SDK, which re-parses internally.
 */

import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { clearFreeze } from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	getAccountByStripeCustomerId,
	setAccountPlan,
} from "@secondlayer/platform/db/queries/accounts";
import { logger } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import type Stripe from "stripe";
import {
	getStripeOrNull,
	getStripeWebhookSecretOrNull,
} from "../lib/stripe.ts";
import { getTierForPriceId } from "../lib/tier-mapping.ts";

const app = new Hono();

app.post("/", async (c) => {
	const signature = c.req.header("stripe-signature");
	if (!signature) {
		return c.json({ error: "Missing stripe-signature header" }, 400);
	}

	const stripe = getStripeOrNull();
	const secret = getStripeWebhookSecretOrNull();
	if (!stripe || !secret) {
		logger.info("Stripe webhook received but billing not configured", {
			hasKey: Boolean(stripe),
			hasSecret: Boolean(secret),
		});
		return c.json({ error: "billing_not_configured" }, 503);
	}

	const raw = await c.req.text();

	let event: Stripe.Event;
	try {
		event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
	} catch (err) {
		logger.warn("Stripe webhook signature mismatch", {
			error: err instanceof Error ? err.message : String(err),
		});
		return c.json({ error: "Signature verification failed" }, 400);
	}

	logger.info("Stripe webhook received", {
		id: event.id,
		type: event.type,
		livemode: event.livemode,
	});

	let outcome: StripeWebhookOutcome;
	try {
		outcome = await processStripeEvent(getDb(), event);
	} catch (err) {
		// The transaction rolled back — marker NOT persisted. Return 500 so
		// Stripe redelivers (backoff over ~3 days). A permanently-poisoned event
		// stops retrying on Stripe's side; far better than silently losing a paid
		// event by 200-ing a rolled-back effect.
		logger.error(
			"Stripe webhook handler failed; rolled back, signaling retry",
			{
				id: event.id,
				type: event.type,
				error: err instanceof Error ? err.message : String(err),
			},
		);
		return c.json({ error: "handler_failed" }, 500);
	}

	if (outcome === "duplicate") {
		logger.info("Stripe webhook event already processed — skipping", {
			id: event.id,
			type: event.type,
		});
		return c.body(null, 200);
	}
	return c.json({ received: true });
});

export type StripeWebhookOutcome = "processed" | "duplicate";

/**
 * Marker + effect in ONE transaction. If the handler throws, the whole
 * transaction (including the processed_stripe_events row) rolls back, so the
 * caller returns non-2xx and Stripe redelivers. Concurrent duplicate
 * deliveries serialize on the event_id unique constraint.
 */
export async function processStripeEvent(
	db: Kysely<Database>,
	event: Stripe.Event,
): Promise<StripeWebhookOutcome> {
	return db.transaction().execute(async (trx) => {
		const inserted = await trx
			.insertInto("processed_stripe_events")
			.values({ event_id: event.id, event_type: event.type })
			.onConflict((oc) => oc.column("event_id").doNothing())
			.executeTakeFirst();
		if ((inserted.numInsertedOrUpdatedRows ?? 0n) === 0n) return "duplicate";

		if (event.type === "invoice.paid") {
			const invoice = event.data.object as Stripe.Invoice;
			const customerId =
				typeof invoice.customer === "string"
					? invoice.customer
					: invoice.customer?.id;
			if (customerId) await onInvoicePaid(trx, customerId);
		} else if (
			event.type === "customer.subscription.created" ||
			event.type === "customer.subscription.updated"
		) {
			await onSubscriptionActive(
				trx,
				event.data.object as Stripe.Subscription,
				event.id,
			);
		} else if (event.type === "customer.subscription.deleted") {
			await onSubscriptionDeleted(
				trx,
				event.data.object as Stripe.Subscription,
				event.id,
			);
		} else if (event.type === "checkout.session.completed") {
			await onCheckoutCompleted(
				trx,
				event.data.object as Stripe.Checkout.Session,
				event.id,
			);
		}
		return "processed";
	});
}

/** invoice.paid — clear any cap freeze at cycle rollover. */
async function onInvoicePaid(
	db: Kysely<Database>,
	stripeCustomerId: string,
): Promise<void> {
	const account = await getAccountByStripeCustomerId(db, stripeCustomerId);
	if (!account) {
		logger.warn("invoice.paid: no account matches stripe_customer_id", {
			stripeCustomerId,
		});
		return;
	}
	await clearFreeze(db, account.id);
	logger.info("Cleared spend-cap freeze on invoice.paid", {
		accountId: account.id,
	});
}

/**
 * customer.subscription.{created,updated} — resolve first line-item
 * price id to a tier and write `accounts.plan`.
 *
 * Status filter:
 *   active / trialing → set plan to tier
 *   canceled / unpaid / incomplete_expired → set no-plan and suspend tenant
 *   past_due / incomplete → no-op (don't demote mid-dispute)
 */
async function onSubscriptionActive(
	db: Kysely<Database>,
	sub: Stripe.Subscription,
	eventId: string,
): Promise<void> {
	const customerId =
		typeof sub.customer === "string" ? sub.customer : sub.customer.id;

	const account = await getAccountByStripeCustomerId(db, customerId);
	if (!account) {
		logger.warn("stripe.webhook.subscription.no_account", {
			eventId,
			customerId,
		});
		return;
	}

	const status = sub.status;
	const firstItem = sub.items.data[0];
	const priceId = firstItem?.price.id;

	if (!priceId) {
		logger.warn("stripe.webhook.subscription.no_price", {
			eventId,
			subscriptionId: sub.id,
		});
		return;
	}

	if (status === "active" || status === "trialing") {
		const tier = getTierForPriceId(priceId);
		if (!tier) {
			logger.warn("stripe.webhook.subscription.unknown_price", {
				eventId,
				priceId,
				subscriptionId: sub.id,
				status,
			});
			return;
		}
		await setAccountPlan(db, account.id, tier);
		logger.info("stripe.webhook.subscription.resolved", {
			eventId,
			accountId: account.id,
			tier,
			status,
		});
	} else if (
		status === "canceled" ||
		status === "unpaid" ||
		status === "incomplete_expired"
	) {
		await setAccountPlan(db, account.id, "none");
		logger.info("stripe.webhook.subscription.reverted", {
			eventId,
			accountId: account.id,
			status,
		});
	} else {
		logger.info("stripe.webhook.subscription.skipped", {
			eventId,
			accountId: account.id,
			status,
			reason: "status not actionable",
		});
	}
}

/** customer.subscription.deleted — remove plan. Tenant-suspend removed post shared-rip. */
async function onSubscriptionDeleted(
	db: Kysely<Database>,
	sub: Stripe.Subscription,
	eventId: string,
): Promise<void> {
	const customerId =
		typeof sub.customer === "string" ? sub.customer : sub.customer.id;
	const account = await getAccountByStripeCustomerId(db, customerId);
	if (!account) {
		logger.warn("stripe.webhook.subscription.no_account", {
			eventId,
			customerId,
		});
		return;
	}
	await setAccountPlan(db, account.id, "none");
	logger.info("stripe.webhook.subscription.deleted", {
		eventId,
		accountId: account.id,
	});
}

/**
 * checkout.session.completed — credit a prepaid dev-credits top-up.
 *
 * Only one-time payment sessions tagged `kind: "credits_topup"` (mode=payment,
 * payment_status=paid); subscription checkouts flow through the events above.
 * Idempotent via `processed_stripe_events`. `amount_total` (what the card
 * actually paid) is the source of truth, cents → USD micros (1¢ = 10,000µ$).
 */
async function onCheckoutCompleted(
	db: Kysely<Database>,
	session: Stripe.Checkout.Session,
	eventId: string,
): Promise<void> {
	if (
		session.mode !== "payment" ||
		session.metadata?.kind !== "credits_topup"
	) {
		return;
	}
	if (session.payment_status !== "paid") return;
	const accountId = session.metadata?.secondlayer_account_id;
	if (!accountId) {
		logger.warn("credits topup: no account_id in session metadata", {
			eventId,
		});
		return;
	}
	const cents = session.amount_total ?? 0;
	if (cents <= 0) return;
	const usdMicros = BigInt(cents) * 10_000n;
	const balance = await creditCredits(db, accountId, usdMicros);
	logger.info("Credited account from top-up", {
		eventId,
		accountId,
		cents,
		balanceUsdMicros: balance.toString(),
	});
}

export default app;
