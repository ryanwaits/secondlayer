import type { Context, MiddlewareHandler } from "hono";
import {
	debitCreditedRows,
	resolveCreditedAccount,
} from "../lib/read-credits.ts";
import type { V1SubgraphsEnv } from "../routes/v1-subgraphs.ts";

export {
	CREDIT_USD_MICROS_PER_ROW,
	MIN_CREDITED_USD_MICROS,
} from "../lib/read-credits.ts";

/**
 * Credits gate (Subgraphs): a free-tier account that topped up prepaid credits
 * goes pay-as-you-go - it bypasses the free rate limit, and pays per row read
 * (debited after the response). Sets `credited` on the context for the rate
 * limiter and the post-read debit to read.
 */
export function subgraphCreditsGate(): MiddlewareHandler<V1SubgraphsEnv> {
	return async (c, next) => {
		const credited = await resolveCreditedAccount(
			c.get("v1AccountId"),
			undefined,
		);
		if (credited) c.set("credited", credited);
		return next();
	};
}

/** Post-read debit for a credited caller - no-op when not credited. */
export async function debitSubgraphCreditedRead(
	c: Context<V1SubgraphsEnv>,
	rows: number,
): Promise<void> {
	await debitCreditedRows(c.get("credited"), rows);
}
