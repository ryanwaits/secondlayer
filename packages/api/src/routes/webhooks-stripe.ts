/**
 * Stripe webhook endpoint — credits payments only.
 *
 * Signature is verified against STRIPE_WEBHOOK_SECRET — bodies that don't
 * verify are rejected 400 (Stripe will retry). Verified events are audited
 * via `processed_stripe_events`; only `checkout.session.completed` (prepaid
 * top-up) and `payment_intent.succeeded` (auto-refill) have effects.
 *
 * Any other event type — including subscription lifecycle events Stripe may
 * still send for pre-retirement data (invoice.paid,
 * customer.subscription.*) — is acked 2xx with just the idempotency marker,
 * so Stripe never retries events we deliberately no longer handle.
 *
 * Important: Hono's default body parser reads JSON, but Stripe signatures
 * are computed over the RAW bytes. We use `c.req.text()` then verify
 * with the SDK, which re-parses internally.
 */

import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
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

		if (event.type === "checkout.session.completed") {
			await onCheckoutCompleted(
				trx,
				event.data.object as Stripe.Checkout.Session,
				event.id,
			);
		} else if (event.type === "payment_intent.succeeded") {
			await onPaymentIntentSucceeded(
				trx,
				event.data.object as Stripe.PaymentIntent,
				event.id,
			);
		}
		// Every other event type (incl. legacy subscription lifecycle) falls
		// through: marker persisted, effectless, acked 2xx by the route.
		return "processed";
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

/** Off-session auto-refill. Checkout top-ups stay on checkout.session.completed. */
async function onPaymentIntentSucceeded(
	db: Kysely<Database>,
	intent: Stripe.PaymentIntent,
	eventId: string,
): Promise<void> {
	if (intent.metadata?.kind !== "credits_refill") return;
	const accountId = intent.metadata.secondlayer_account_id;
	if (!accountId) {
		logger.warn("credits refill: no account_id in payment intent", { eventId });
		return;
	}
	const cents = intent.amount_received || intent.amount;
	if (cents <= 0) return;
	const usdMicros = BigInt(cents) * 10_000n;
	const balance = await creditCredits(db, accountId, usdMicros);
	logger.info("Credited account from refill", {
		eventId,
		accountId,
		cents,
		balanceUsdMicros: balance.toString(),
	});
}

export default app;
