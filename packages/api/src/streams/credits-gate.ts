import type { Context, MiddlewareHandler } from "hono";
import {
	debitCreditedRows,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { StreamsEnv } from "./auth.ts";

export {
	CREDIT_USD_MICROS_PER_ROW,
	MIN_CREDITED_USD_MICROS,
} from "../lib/read-credits.ts";

/**
 * Credits gate (Streams): a free-tier account that topped up prepaid credits
 * goes pay-as-you-go — it bypasses the free retention window + the free rate
 * limit, and pays per row read. Shares one `account_credits` balance with the
 * Index surface. Sets `credited` for the rate limiter, the retention gate, and
 * the post-read debit to read.
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

/** Post-read debit for a credited caller — no-op when not credited. */
export async function debitStreamsCreditedRead(
	c: Context<StreamsEnv>,
	rows: number,
): Promise<void> {
	await debitCreditedRows(c.get("credited"), rows);
}
