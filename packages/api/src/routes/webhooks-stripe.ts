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

import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { clearFreeze } from "@secondlayer/shared/db/queries/account-spend-caps";
import {
	getAccountByStripeCustomerId,
	setAccountPlan,
} from "@secondlayer/shared/db/queries/accounts";
import { recordProvisioningAudit } from "@secondlayer/shared/db/queries/provisioning-audit";
import {
	getTenantByAccount,
	setTenantStatus,
} from "@secondlayer/shared/db/queries/tenants";
import { Hono } from "hono";
import type Stripe from "stripe";
import {
	ProvisionerError,
	suspendTenant as provisionerSuspend,
} from "../lib/provisioner-client.ts";
import {
	getStripeOrNull,
	getStripeWebhookSecretOrNull,
} from "../lib/stripe.ts";
import { syncTenantToPaidPlan } from "../lib/tenant-plan-sync.ts";
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

	// Idempotency. Stripe redelivers events on any non-2xx and on its own
	// retry policy; we may also see a late replay of an old `invoice.paid`
	// arriving days after the cycle it billed. INSERT ON CONFLICT DO
	// NOTHING into `processed_stripe_events` and bail if the event_id is
	// already there — the original processing had its chance.
	const inserted = await getDb()
		.insertInto("processed_stripe_events")
		.values({
			event_id: event.id,
			event_type: event.type,
		})
		.onConflict((oc) => oc.column("event_id").doNothing())
		.executeTakeFirst();
	const isDuplicate = (inserted.numInsertedOrUpdatedRows ?? 0n) === 0n;
	if (isDuplicate) {
		logger.info("Stripe webhook event already processed — skipping", {
			id: event.id,
			type: event.type,
		});
		return c.body(null, 200);
	}

	try {
		if (event.type === "invoice.paid") {
			const invoice = event.data.object as Stripe.Invoice;
			const customerId =
				typeof invoice.customer === "string"
					? invoice.customer
					: invoice.customer?.id;
			if (customerId) await onInvoicePaid(customerId);
		} else if (
			event.type === "customer.subscription.created" ||
			event.type === "customer.subscription.updated"
		) {
			await onSubscriptionActive(
				event.data.object as Stripe.Subscription,
				event.id,
			);
		} else if (event.type === "customer.subscription.deleted") {
			await onSubscriptionDeleted(
				event.data.object as Stripe.Subscription,
				event.id,
			);
		}
	} catch (err) {
		// Always 200 below even on handler error — Stripe retries on
		// non-2xx and a handler bug shouldn't cause a retry storm.
		logger.warn("Stripe webhook handler error", {
			id: event.id,
			type: event.type,
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Best-effort audit trail.
	await recordProvisioningAudit(getDb(), {
		actor: "stripe:webhook",
		event: "provision.start", // reusing enum bucket; broaden later.
		status: "ok",
		detail: {
			stripeEventId: event.id,
			stripeEventType: event.type,
			livemode: event.livemode,
		},
	}).catch((err) => {
		logger.warn("Failed to audit Stripe webhook", {
			id: event.id,
			error: err instanceof Error ? err.message : String(err),
		});
	});

	return c.json({ received: true });
});

/** invoice.paid — clear any cap freeze at cycle rollover. */
async function onInvoicePaid(stripeCustomerId: string): Promise<void> {
	const db = getDb();
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
	sub: Stripe.Subscription,
	eventId: string,
): Promise<void> {
	const db = getDb();
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
		await syncTenantToPaidPlan({
			accountId: account.id,
			targetPlan: tier,
			actor: "stripe:webhook",
			reason: `subscription:${sub.id}:${eventId}`,
		}).catch((err) => {
			logger.error("stripe.webhook.subscription.tenant_sync_failed", {
				eventId,
				accountId: account.id,
				tier,
				error: err instanceof Error ? err.message : String(err),
			});
		});
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
		await suspendTenantForBilling(account.id, eventId, status);
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

/** customer.subscription.deleted — remove plan and suspend tenant. */
async function onSubscriptionDeleted(
	sub: Stripe.Subscription,
	eventId: string,
): Promise<void> {
	const db = getDb();
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
	await suspendTenantForBilling(account.id, eventId, "deleted");
	logger.info("stripe.webhook.subscription.deleted", {
		eventId,
		accountId: account.id,
	});
}

async function suspendTenantForBilling(
	accountId: string,
	eventId: string,
	reason: string,
): Promise<void> {
	const db = getDb();
	const tenant = await getTenantByAccount(db, accountId);
	if (!tenant || tenant.status === "suspended" || tenant.status === "deleted") {
		return;
	}
	try {
		await provisionerSuspend(tenant.slug);
		await setTenantStatus(db, tenant.slug, "suspended");
		await recordProvisioningAudit(db, {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: "stripe:webhook",
			event: "suspend",
			status: "ok",
			detail: { reason, stripeEventId: eventId },
		});
	} catch (err) {
		await recordProvisioningAudit(db, {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: "stripe:webhook",
			event: "suspend",
			status: "error",
			detail: { reason, stripeEventId: eventId },
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			logger.error("stripe.webhook.subscription.suspend_failed", {
				eventId,
				accountId,
				slug: tenant.slug,
				status: err.status,
				body: err.body.slice(0, 500),
			});
			return;
		}
		throw err;
	}
}

export default app;
