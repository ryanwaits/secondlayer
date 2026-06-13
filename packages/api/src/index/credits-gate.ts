import {
	debitCredits,
	getCredits,
	recordCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { Context, MiddlewareHandler } from "hono";
import type { IndexEnv } from "./auth.ts";

/** $5 per 1M rows read = 5 USD-micros per row. */
export const CREDIT_USD_MICROS_PER_ROW = 5n;

/**
 * Minimum balance to go pay-as-you-go: one full page (1000 rows × 5µ$ = 5000µ$
 * = $0.005). Gating at the max single-page cost guarantees the post-read debit
 * always covers the actual rows served (cost ≤ this ≤ balance), so there's no
 * dust-balance loophole where an under-a-page balance serves free forever.
 */
export const MIN_CREDITED_USD_MICROS = 5_000n;

/**
 * Credits gate: a free-tier account that topped up prepaid credits goes
 * pay-as-you-go — it bypasses the free 24h window + the free rate limit, and
 * pays per row read (debited after the response). Only free-tier account-backed
 * callers are candidates: paid tiers already have full history + headroom; anon
 * and x402 callers have no account-keyed credits. Sets `credited` on the context
 * for the rate limiter, the free-window gate, and the post-read debit to read.
 */
export function indexCreditsGate(): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		const tenant = c.get("indexTenant");
		if (isPlatformMode() && tenant?.account_id && tenant.tier === "free") {
			const balance = await getCredits(getDb(), tenant.account_id);
			if (balance >= MIN_CREDITED_USD_MICROS) {
				c.set("credited", { accountId: tenant.account_id, balance });
			}
		}
		return next();
	};
}

/**
 * Post-read debit for a credited caller. Called after a successful read with the
 * row count; the gate guaranteed `balance ≥ max-page-cost`, so the atomic
 * `balance >= cost` debit always succeeds for a single page. No-op when the
 * caller isn't credited. Records the spend for the monthly counter on success.
 */
export async function debitCreditedRead(
	c: Context<IndexEnv>,
	rows: number,
): Promise<void> {
	const credited = c.get("credited");
	if (!credited || rows <= 0) return;
	const cost = BigInt(rows) * CREDIT_USD_MICROS_PER_ROW;
	const db = getDb();
	const res = await debitCredits(db, credited.accountId, cost);
	if (res.ok) await recordCreditsSpend(db, credited.accountId, cost);
}
