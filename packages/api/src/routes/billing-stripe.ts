/**
 * Stripe webhook endpoint — credits payments only.
 *
 * Signature is verified against STRIPE_WEBHOOK_SECRET — bodies that don't
 * verify are rejected 400 (Stripe will retry). Verified events are audited
 * via `processed_stripe_events`; only `checkout.session.completed` (prepaid
 * top-up) and `payment_intent.succeeded` (auto-refill) credit the balance;
 * `charge.refunded` and `charge.dispute.created` take credit back (capped at
 * what the balance still holds). Every credit and clawback is keyed on the
 * payment intent, so one payment moves the balance once.
 *
 * Any other event type — including subscription lifecycle events Stripe may
 * still send for pre-retirement data (invoice.paid,
 * customer.subscription.*) — is acked 2xx with just the idempotency marker,
 * so Stripe never retries events we deliberately no longer handle.
 *
 * The Stripe account is shared with Sentinel, which bills on its own
 * subscriptions and tags its objects `metadata.product = "sentinel"`. Those
 * events are acked and ignored before anything else runs: no marker, no
 * effect, whatever else their metadata says. Every handler added here must
 * stay behind that gate.
 *
 * Important: Hono's default body parser reads JSON, but Stripe signatures
 * are computed over the RAW bytes. We use `c.req.text()` then verify
 * with the SDK, which re-parses internally.
 */

import { recordRefund, recordTopup } from "@secondlayer/platform/billing/meter";
import {
	accountForLedgerKey,
	lastCumulativeCents,
} from "@secondlayer/platform/db/queries/usage-ledger";
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

	if (outcome === "ignored") {
		logger.info("Stripe webhook event belongs to Sentinel — ignored", {
			id: event.id,
			type: event.type,
		});
		return c.json({ received: true });
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

export type StripeWebhookOutcome = "processed" | "duplicate" | "ignored";

/** Metadata Sentinel puts on its Stripe objects (customers, subscriptions,
 *  checkout sessions, and the invoices that inherit a subscription's). */
const SENTINEL_PRODUCT = "sentinel";

type MetadataCarrier = {
	metadata?: Record<string, string> | null;
	subscription_details?: { metadata?: Record<string, string> | null } | null;
	parent?: {
		subscription_details?: { metadata?: Record<string, string> | null } | null;
	} | null;
};

/** True when the event's object belongs to Sentinel: its own metadata, or for
 *  an invoice the subscription metadata it carries (both Stripe API shapes). */
export function isSentinelEvent(event: Stripe.Event): boolean {
	const obj = event.data.object as unknown as MetadataCarrier | null;
	if (!obj) return false;
	return [
		obj.metadata,
		obj.subscription_details?.metadata,
		obj.parent?.subscription_details?.metadata,
	].some((m) => m?.product === SENTINEL_PRODUCT);
}

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
	if (isSentinelEvent(event)) return "ignored";
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
		} else if (event.type === "charge.refunded") {
			await onChargeRefunded(trx, event.data.object as Stripe.Charge, event.id);
		} else if (event.type === "charge.dispute.created") {
			await onDisputeCreated(
				trx,
				event.data.object as Stripe.Dispute,
				event.id,
			);
		}
		// Every other event type (incl. legacy subscription lifecycle) falls
		// through: marker persisted, effectless, acked 2xx by the route.
		return "processed";
	});
}

/** A Stripe object reference: the id, whether expanded or not. */
function stripeId(
	ref: string | { id: string } | null | undefined,
): string | null {
	if (!ref) return null;
	return typeof ref === "string" ? ref : ref.id;
}

/** The ledger key a top-up is credited under: the payment intent, so the same
 *  payment arriving on two events credits once. Falls back to the event id
 *  only when Stripe sent no payment intent. */
function topupKey(paymentIntentId: string | null, eventId: string): string {
	return paymentIntentId ? `stripe:pi:${paymentIntentId}` : `stripe:${eventId}`;
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
	const paymentIntentId = stripeId(session.payment_intent);
	const { balance } = await recordTopup(db, {
		accountId,
		usdMicros,
		source: "stripe:checkout",
		idempotencyKey: topupKey(paymentIntentId, eventId),
	});
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
	const { balance } = await recordTopup(db, {
		accountId,
		usdMicros,
		source: "stripe:refill",
		idempotencyKey: topupKey(intent.id, eventId),
	});
	logger.info("Credited account from refill", {
		eventId,
		accountId,
		cents,
		balanceUsdMicros: balance.toString(),
	});
}

/**
 * charge.refunded: take back credit for money Stripe returned. The charge
 * carries the CUMULATIVE `amount_refunded`; each step claws back only what is
 * new since the last step recorded for the payment intent, so partial refunds
 * add up and a redelivered or out-of-order event never counts twice. The
 * account is whoever the payment intent's top-up credited; a charge that is
 * not one of our top-ups is ignored.
 */
async function onChargeRefunded(
	db: Kysely<Database>,
	charge: Stripe.Charge,
	eventId: string,
): Promise<void> {
	const paymentIntentId = stripeId(charge.payment_intent);
	if (!paymentIntentId) return;
	const accountId =
		(await accountForLedgerKey(db, `stripe:pi:${paymentIntentId}`)) ??
		creditAccountFromMetadata(charge.metadata);
	if (!accountId) {
		logger.warn("refund for a charge that is not a known top-up", {
			eventId,
			paymentIntentId,
		});
		return;
	}
	const prefix = `stripe:refund:${paymentIntentId}:`;
	const refundedCents = charge.amount_refunded;
	const newCents = refundedCents - (await lastCumulativeCents(db, prefix));
	if (newCents <= 0) return;
	const { takenUsdMicros } = await recordRefund(db, {
		accountId,
		usdMicros: BigInt(newCents) * 10_000n,
		source: "stripe:refund",
		idempotencyKey: `${prefix}${refundedCents}`,
	});
	logger.info("Took back credit for a refund", {
		eventId,
		accountId,
		newCents,
		takenUsdMicros: takenUsdMicros.toString(),
	});
}

/**
 * charge.dispute.created: take back the disputed amount at once, capped at the
 * balance. The dispute's payment intent finds the top-up's account; keyed per
 * dispute, so a redelivery claws back once. A dispute won later does not
 * restore the credit (handled by hand).
 */
async function onDisputeCreated(
	db: Kysely<Database>,
	dispute: Stripe.Dispute,
	eventId: string,
): Promise<void> {
	const paymentIntentId = stripeId(dispute.payment_intent);
	if (!paymentIntentId) {
		logger.warn("dispute with no payment intent", {
			eventId,
			disputeId: dispute.id,
		});
		return;
	}
	const accountId = await accountForLedgerKey(
		db,
		`stripe:pi:${paymentIntentId}`,
	);
	if (!accountId) {
		logger.warn("dispute for a payment that is not a known top-up", {
			eventId,
			disputeId: dispute.id,
			paymentIntentId,
		});
		return;
	}
	if (dispute.amount <= 0) return;
	const { takenUsdMicros } = await recordRefund(db, {
		accountId,
		usdMicros: BigInt(dispute.amount) * 10_000n,
		source: "stripe:dispute",
		idempotencyKey: `stripe:dispute:${dispute.id}`,
	});
	logger.info("Took back credit for a dispute", {
		eventId,
		accountId,
		disputeId: dispute.id,
		takenUsdMicros: takenUsdMicros.toString(),
	});
}

/** The account a charge's metadata names, only for our own credit payments. */
function creditAccountFromMetadata(
	metadata: Record<string, string> | null | undefined,
): string | null {
	const kind = metadata?.kind;
	if (kind !== "credits_topup" && kind !== "credits_refill") return null;
	return metadata?.secondlayer_account_id ?? null;
}

export default app;
