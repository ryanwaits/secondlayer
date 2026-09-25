import type { Context, MiddlewareHandler } from "hono";
import {
	meterRowsDelivered,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { StreamsEnv } from "./auth.ts";

export { MIN_CREDITED_USD_MICROS } from "../lib/read-credits.ts";

/**
 * Credits gate (Streams): a free-tier account that topped up prepaid credits
 * goes unthrottled — it bypasses the free rate limit and pays per row read
 * past the monthly allowance. Shares one `account_credits` balance with the
 * Index surface. Sets `credited` for the rate limiter.
 */
export function streamsCreditsGate(): MiddlewareHandler<StreamsEnv> {
	return async (c, next) => {
		const tenant = c.get("streamsTenant");
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
export async function debitStreamsCreditedRead(
	c: Context<StreamsEnv>,
	rows: readonly unknown[],
): Promise<void> {
	const accountId = c.get("streamsTenant")?.account_id;
	if (!accountId) return;
	await meterRowsDelivered(accountId, rows.length, "streams");
}
