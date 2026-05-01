import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getAccountById } from "@secondlayer/shared/db/queries/accounts";
import { getStripeOrNull } from "./stripe.ts";

/**
 * Stripe billing meter event names. Keep in sync with the meters created
 * by `packages/api/scripts/stripe-setup.ts`.
 */
export type MeterEventName = "ai_evals" | "storage_gb_months";

/**
 * Emit a metered usage event to Stripe. Best-effort — metering must
 * never break user-visible flows. Skips silently when:
 *   - Stripe is not configured (test envs)
 *   - The account has no `stripe_customer_id` (Hobby tenants who never
 *     upgraded → no subscription → no meter to bill against)
 *
 * Errors are logged and swallowed.
 */
export async function emitMeterEvent(
	accountId: string,
	eventName: MeterEventName,
	value: number,
): Promise<void> {
	if (!Number.isFinite(value) || value <= 0) return;

	const stripe = getStripeOrNull();
	if (!stripe) return;

	try {
		const account = await getAccountById(getDb(), accountId);
		if (!account?.stripe_customer_id) return;

		await stripe.billing.meterEvents.create({
			event_name: eventName,
			payload: {
				stripe_customer_id: account.stripe_customer_id,
				value: String(Math.round(value)),
			},
		});
	} catch (err) {
		logger.warn("emitMeterEvent failed", {
			accountId,
			eventName,
			value,
			err: err instanceof Error ? err.message : String(err),
		});
	}
}
