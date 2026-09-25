import type { Context, MiddlewareHandler } from "hono";
import {
	checkRowsAllowance,
	meterRowsDelivered,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { IndexEnv } from "./auth.ts";

export { MIN_CREDITED_USD_MICROS } from "../lib/read-credits.ts";

/**
 * Credits gate (Index): pre-check, then debit. A keyed account whose monthly
 * `rows.delivered` allowance is used up AND whose balance is short refuses
 * the read here with 402 `insufficient_credits`, before anything is served —
 * without this, deleting the old free-height window would make a $0-balance
 * key an unmetered feed of all history (every read served free, only
 * recorded as `debited: false`). An account still under the allowance, or
 * with enough balance, is served; a free-tier account with a topped-up
 * balance also goes unthrottled (sets `credited` for the rate limiter).
 */
export function indexCreditsGate(): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		const tenant = c.get("indexTenant");
		const refusal = await checkRowsAllowance(tenant?.account_id, tenant?.tier);
		if (refusal) return c.json(refusal, 402);

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
 *  and any debit happen inside `meter()`. The pre-check above already
 *  refused a read that couldn't start; this can only make an
 *  allowance-straddling read's overflow visible (`debited: false`) if the
 *  balance runs short mid-page. */
export async function debitCreditedRead(
	c: Context<IndexEnv>,
	rows: readonly unknown[],
): Promise<void> {
	const accountId = c.get("indexTenant")?.account_id;
	if (!accountId) return;
	await meterRowsDelivered(accountId, rows.length, "index");
}
