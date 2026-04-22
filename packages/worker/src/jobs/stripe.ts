import Stripe from "stripe";

/**
 * Lazy Stripe SDK singleton for the worker.
 *
 * Kept separate from the API's client so the worker can no-op cleanly
 * when `STRIPE_SECRET_KEY` isn't set (local dev, OSS mode). The API has
 * the same pattern — we duplicate 20 lines to avoid pulling a stripe
 * dep into `@secondlayer/shared` just for this.
 */

let instance: Stripe | null = null;

export function getStripe(): Stripe | null {
	if (instance) return instance;
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) return null;
	instance = new Stripe(key, {
		apiVersion: "2026-03-25.dahlia",
		appInfo: { name: "Secondlayer Worker", url: "https://secondlayer.tools" },
	});
	return instance;
}

/**
 * Should we push Stripe meter events for this tenant?
 *
 * No for:
 *   - Tenants whose account has no Stripe customer id (free tier — the
 *     whole point of lazy customer creation)
 *   - Enterprise tenants without a subscription id (custom-quoted; not
 *     self-serve metered)
 *
 * Yes for:
 *   - Anything with a stripe_customer_id. Current that's Pro; later
 *     Enterprise once manual setup attaches metered prices.
 */
export function shouldMeterTenant(input: {
	stripeCustomerId: string | null;
}): boolean {
	return !!input.stripeCustomerId;
}
