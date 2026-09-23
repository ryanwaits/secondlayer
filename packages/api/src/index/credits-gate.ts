import type { Context, MiddlewareHandler } from "hono";
import {
	billableRowCount,
	debitCreditedRows,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { IndexEnv } from "./auth.ts";

export {
	CREDIT_USD_MICROS_PER_ROW,
	MIN_CREDITED_USD_MICROS,
} from "../lib/read-credits.ts";

/**
 * Credits gate (Index): a free-tier account that topped up prepaid credits goes
 * pay-as-you-go — it bypasses the free 24h window + the free rate limit, and
 * pays per row read (debited after the response). Sets `credited` on the context
 * for the rate limiter, the free-window gate, and the post-read debit to read.
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

/** Post-read debit for a credited caller — no-op when not credited. Rows
 *  inside the free window are not charged. */
export async function debitCreditedRead(
	c: Context<IndexEnv>,
	rows: readonly unknown[],
): Promise<void> {
	await debitCreditedRows(
		c.get("credited"),
		billableRowCount(rows, c.get("indexTip")?.block_height),
	);
}
