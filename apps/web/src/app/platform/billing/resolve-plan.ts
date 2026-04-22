import "server-only";

import { apiRequest } from "@/lib/api";
import type { BillingTier } from "@/lib/billing";

/**
 * After a successful Stripe Checkout redirect (`?upgrade=success`),
 * the subscription webhook may not have fired yet — leaving the
 * account on plan=hobby for a few seconds to minutes. To avoid the
 * user seeing Hobby on the "thank you" view, the billing page calls
 * this helper which asks the platform API to do a one-shot Stripe
 * read + write plan synchronously.
 *
 * The platform API exposes this through the same session auth as the
 * rest of the billing routes. On any failure (Stripe down, account
 * missing, no subscription yet), returns null and the caller falls
 * back to webhook-race behavior.
 */
export async function resolvePlanFromStripe(
	sessionToken: string,
): Promise<BillingTier | null> {
	try {
		const data = await apiRequest<{ plan: BillingTier }>(
			"/api/billing/resolve",
			{
				method: "POST",
				sessionToken,
			},
		);
		return data.plan;
	} catch {
		return null;
	}
}
