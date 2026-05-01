import Stripe from "stripe";

/**
 * Lazy Stripe SDK singleton. Read `STRIPE_SECRET_KEY` from env the first
 * time the client is requested. Two variants:
 *   - `getStripe()` throws if missing — use in code paths that have
 *     already gated on configuration (CLI scripts, workers).
 *   - `getStripeOrNull()` returns null — use inside route handlers so
 *     unconfigured installs respond 503 instead of leaking a 500 with
 *     an unhandled-error stack trace.
 */

let instance: Stripe | null = null;

function construct(key: string): Stripe {
	return new Stripe(key, {
		// Pin API version so Stripe-side upgrades don't break us mid-flight.
		// Bump deliberately when we're ready to adopt new features.
		apiVersion: "2026-03-25.dahlia",
		appInfo: {
			name: "Secondlayer",
			url: "https://secondlayer.tools",
		},
	});
}

export function getStripe(): Stripe {
	if (!instance) {
		const key = process.env.STRIPE_SECRET_KEY;
		if (!key) {
			throw new Error(
				"STRIPE_SECRET_KEY is required for billing routes. " +
					"Set it in your .env (test: rk_test_... / sk_test_..., live: sk_live_...).",
			);
		}
		instance = construct(key);
	}
	return instance;
}

export function getStripeOrNull(): Stripe | null {
	if (instance) return instance;
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) return null;
	instance = construct(key);
	return instance;
}

/** Webhook signing secret — only needed when the webhook route is mounted. */
export function getStripeWebhookSecret(): string {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			"STRIPE_WEBHOOK_SECRET is required for /api/webhooks/stripe. " +
				"For local dev run `stripe listen --forward-to localhost:3800/api/webhooks/stripe` " +
				"and paste the printed whsec_... into your .env.",
		);
	}
	return secret;
}

export function getStripeWebhookSecretOrNull(): string | null {
	return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

/**
 * Find the customer's active subscription + the line item we manage
 * (the recurring tier price). Returns null when the customer has no
 * active subscription — Hobby tenants and freshly-cancelled ones.
 *
 * "Item we manage" = the first item whose price has a recurring usage_type
 * of `licensed`. Metered overage items (storage, AI eval) are skipped so
 * we don't accidentally swap them when changing tiers.
 */
export async function resolveSubscriptionItem(
	stripe: Stripe,
	customerId: string,
): Promise<{
	subscriptionId: string;
	itemId: string;
	currentPriceId: string;
} | null> {
	const subs = await stripe.subscriptions.list({
		customer: customerId,
		status: "active",
		limit: 1,
		expand: ["data.items.data.price"],
	});
	const sub = subs.data[0];
	if (!sub) return null;
	const tierItem = sub.items.data.find(
		(i) => i.price.recurring?.usage_type !== "metered",
	);
	if (!tierItem) return null;
	return {
		subscriptionId: sub.id,
		itemId: tierItem.id,
		currentPriceId: tierItem.price.id,
	};
}
