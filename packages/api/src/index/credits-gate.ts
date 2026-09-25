import type { Context, MiddlewareHandler } from "hono";
import {
	meterRowsDelivered,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { IndexEnv } from "./auth.ts";

export { MIN_CREDITED_USD_MICROS } from "../lib/read-credits.ts";

/**
 * Credits gate (Index): a free-tier account that topped up prepaid credits
 * goes unthrottled — it bypasses the free rate limit and pays per row read
 * past the monthly allowance (debited after the response). Sets `credited`
 * on the context for the rate limiter.
 */
export function indexCreditsGate(): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		const tenant = c.get("indexTenant");
		const credited = await resolveCreditedAccount(
			tenant?.account_id,
			tenant?.tier,
		);
		if (credited) c.set("credited", credited);
		return next();
	};
}

/** Post-read meter for a keyed caller — no-op for anon/internal (no
 *  account_id). Meters every row, live or history; the monthly allowance
 *  and any debit happen inside `meter()`. */
export async function debitCreditedRead(
	c: Context<IndexEnv>,
	rows: readonly unknown[],
): Promise<void> {
	const accountId = c.get("indexTenant")?.account_id;
	if (!accountId) return;
	await meterRowsDelivered(accountId, rows.length, "index");
}
