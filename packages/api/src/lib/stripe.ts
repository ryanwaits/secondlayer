import Stripe from "stripe";

/**
 * Lazy Stripe SDK singleton. Read `STRIPE_SECRET_KEY` from env the first
 * time the client is requested, throw clearly if missing. Separate from
 * construction at module-load so non-billing code paths don't crash on
 * boot when Stripe isn't configured (e.g. local dev, OSS mode).
 */

let instance: Stripe | null = null;

export function getStripe(): Stripe {
	if (!instance) {
		const key = process.env.STRIPE_SECRET_KEY;
		if (!key) {
			throw new Error(
				"STRIPE_SECRET_KEY is required for billing routes. " +
					"Set it in your .env (test: rk_test_... / sk_test_..., live: sk_live_...).",
			);
		}
		instance = new Stripe(key, {
			// Pin API version so Stripe-side upgrades don't break us mid-flight.
			// Bump deliberately when we're ready to adopt new features.
			apiVersion: "2026-03-25.dahlia",
			appInfo: {
				name: "Secondlayer",
				url: "https://secondlayer.tools",
			},
		});
	}
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
