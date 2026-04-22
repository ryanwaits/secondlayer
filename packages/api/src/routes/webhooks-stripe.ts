/**
 * Stripe webhook endpoint.
 *
 * Signature is verified against STRIPE_WEBHOOK_SECRET — bodies that don't
 * verify are rejected 400 (Stripe will retry). Verified events are
 * audited; state reconciliation (subscription lifecycle, meter
 * cancellation, etc.) lands with the metering + caps work.
 *
 * Important: Hono's default body parser reads JSON, but Stripe signatures
 * are computed over the RAW bytes. We use `c.req.text()` then verify
 * with the SDK, which re-parses internally.
 */

import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { recordProvisioningAudit } from "@secondlayer/shared/db/queries/provisioning-audit";
import { Hono } from "hono";
import type Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "../lib/stripe.ts";

const app = new Hono();

app.post("/", async (c) => {
	const signature = c.req.header("stripe-signature");
	if (!signature) {
		return c.json({ error: "Missing stripe-signature header" }, 400);
	}

	const raw = await c.req.text();
	const stripe = getStripe();
	const secret = getStripeWebhookSecret();

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

	// Best-effort audit trail. Lookups + reconciliation logic get added
	// when the metering + cap work lands; for now the receipt itself is
	// the signal.
	await recordProvisioningAudit(getDb(), {
		actor: "stripe:webhook",
		event: "provision.start", // reusing enum bucket — not exactly right, but
		// keeps the audit query helper usable. Replace with a dedicated
		// `stripe.webhook.received` event once the enum is broadened.
		status: "ok",
		detail: {
			stripeEventId: event.id,
			stripeEventType: event.type,
			livemode: event.livemode,
		},
	}).catch((err) => {
		// Never let audit logging fail the webhook — Stripe will retry on
		// any non-2xx response and we don't want a DB hiccup to spam events.
		logger.warn("Failed to audit Stripe webhook", {
			id: event.id,
			error: err instanceof Error ? err.message : String(err),
		});
	});

	// Stripe expects a 2xx within 30s or it retries. We always respond
	// immediately; heavy reconciliation happens async via dedicated jobs.
	return c.json({ received: true });
});

export default app;
