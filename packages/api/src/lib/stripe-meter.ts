import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getCaps } from "@secondlayer/shared/db/queries/account-spend-caps";
import { getAccountById } from "@secondlayer/shared/db/queries/accounts";
import { getStripeOrNull } from "./stripe.ts";

/**
 * Stripe billing meter event names. Keep in sync with the meters created
 * by `packages/api/scripts/stripe-setup.ts`.
 *
 * Unit semantics:
 *   - `ai_evals`         → 1 unit = 1,000 tokens (input + output combined).
 *                          Stripe price is $0.01/unit ⇒ $0.01 per 1k tokens.
 *                          Anthropic Sonnet blended rate is ~$0.009/1k, so
 *                          we bill near-cost with a small buffer.
 *   - `storage_gb_months`→ 1 unit = 1 GB-month over plan allowance, $2/unit.
 */
export type MeterEventName = "ai_evals" | "storage_gb_months";

/**
 * Per-call ceiling on values we'll emit. Even a single 200k-token Sonnet
 * call is 200 units; 50k units is 50M tokens or 25,000 GB-months — well
 * above any legitimate single emission. Anything bigger is almost
 * certainly an upstream bug.
 */
const PER_CALL_MAX_UNITS = 50_000;

/**
 * Emit a metered usage event to Stripe. Best-effort — metering must
 * never break user-visible flows. Skips silently when:
 *   - Stripe is not configured (test envs)
 *   - The account has no `stripe_customer_id` (Hobby tenants who never
 *     upgraded → no subscription → no meter to bill against)
 *   - The account is frozen via spend cap (frozen_at IS NOT NULL).
 *     This is the runtime gate that keeps a frozen account from
 *     accumulating *more* metered charges. Without it, a user who hits
 *     their cap, sees the "frozen" UI banner, and keeps chatting would
 *     keep adding to next-cycle's bill silently.
 *
 * Errors are logged and swallowed.
 */
export async function emitMeterEvent(
	accountId: string,
	eventName: MeterEventName,
	value: number,
): Promise<void> {
	if (!Number.isFinite(value) || value <= 0) return;
	const clamped = Math.min(Math.round(value), PER_CALL_MAX_UNITS);

	const stripe = getStripeOrNull();
	if (!stripe) return;

	try {
		const db = getDb();
		const [account, caps] = await Promise.all([
			getAccountById(db, accountId),
			getCaps(db, accountId),
		]);
		if (!account?.stripe_customer_id) return;
		if (caps?.frozen_at) {
			// Customer is over their cap. Don't add more billable usage —
			// they already saw the freeze banner and chose to keep using.
			// (UI prevents most paths but the API surface is the boundary.)
			return;
		}

		await stripe.billing.meterEvents.create({
			event_name: eventName,
			payload: {
				stripe_customer_id: account.stripe_customer_id,
				value: String(clamped),
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

/**
 * Convert a raw input+output token count to AI eval meter units.
 * Returns 0 if `totalTokens <= 0` (no event should be emitted at all).
 * Returns at least 1 unit for any non-trivial call so we don't lose
 * sub-1k-token responses.
 */
export function aiEvalUnits(totalTokens: number): number {
	if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
	return Math.max(1, Math.round(totalTokens / 1000));
}
