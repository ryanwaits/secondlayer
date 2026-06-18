import {
	debitCredits,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";

/**
 * Shared pay-as-you-go read metering for Index + Streams. A free-tier account
 * that topped up prepaid credits reads beyond the free window, unthrottled, and
 * pays per row. One `account_credits` balance covers both surfaces.
 */

/** $5 per 1M rows read = 5 USD-micros per row. */
export const CREDIT_USD_MICROS_PER_ROW = 5n;

/** $2 per 1M rows — commit-tier rate for accounts spending ≥$50/mo (≈10M rows). */
const CREDIT_USD_MICROS_PER_ROW_VOLUME = 2n;

/** Monthly-spend threshold for the commit-tier rate: $50 = 50M µ$. */
const COMMIT_TIER_MONTHLY_USD_MICROS = 50_000_000n;

/**
 * Minimum balance to go pay-as-you-go: one full page (1000 rows × 5µ$ = 5000µ$
 * = $0.005). Gating at the max single-page cost guarantees the post-read debit
 * always covers the rows served (cost ≤ this ≤ balance), so there's no
 * dust-balance loophole where an under-a-page balance serves free forever.
 */
export const MIN_CREDITED_USD_MICROS = 5_000n;

export type Credited = { accountId: string; balance: bigint };

/** Stripe/cap dimensions are stored in cents; credit spend in USD-micros. */
const USD_MICROS_PER_CENT = 10_000n;

/**
 * Has this month's pay-as-you-go credit spend reached the account's configured
 * monthly cap? `null` cap = no cap = never over. This is the real-time gate that
 * makes `account_spend_caps.monthly_cap_cents` actually bite the credits rail —
 * the daily cron only mirrors the same comparison into `frozen_at` + an email.
 */
export function isOverMonthlyCreditCap(
	spentUsdMicros: bigint,
	monthlyCapCents: number | null,
): boolean {
	if (monthlyCapCents == null) return false;
	return spentUsdMicros >= BigInt(monthlyCapCents) * USD_MICROS_PER_CENT;
}

/**
 * A free-tier account with enough prepaid balance → pay-as-you-go, else
 * undefined. Only free-tier account-backed callers qualify: paid tiers already
 * have full history + headroom; anon / x402 callers have no account credits.
 *
 * Spend cap: once this month's credit spend reaches the account's monthly cap,
 * stop crediting so reads fall back to the free window — the hard stop the
 * spend-cap freeze always promised but never enforced.
 */
export async function resolveCreditedAccount(
	accountId: string | undefined,
	tier: string | undefined,
): Promise<Credited | undefined> {
	if (!isPlatformMode() || !accountId || tier !== "free") return undefined;
	const db = getDb();
	const balance = await getCredits(db, accountId);
	if (balance < MIN_CREDITED_USD_MICROS) return undefined;

	const caps = await getCaps(db, accountId);
	if (caps?.monthly_cap_cents != null) {
		const spent = await getMonthlyCreditsSpend(db, accountId);
		if (isOverMonthlyCreditCap(spent, caps.monthly_cap_cents)) return undefined;
	}

	return { accountId, balance };
}

/**
 * Debit a credited caller per row read. The gate guaranteed `balance ≥
 * max-page-cost`, so the atomic `balance >= cost` debit always covers a single
 * page. No-op when not credited; records the spend on success.
 */
export async function debitCreditedRows(
	credited: Credited | undefined,
	rows: number,
): Promise<void> {
	if (!credited || rows <= 0) return;
	const db = getDb();
	const monthlySpend = await getMonthlyCreditsSpend(db, credited.accountId);
	const rate =
		monthlySpend >= COMMIT_TIER_MONTHLY_USD_MICROS
			? CREDIT_USD_MICROS_PER_ROW_VOLUME
			: CREDIT_USD_MICROS_PER_ROW;
	const cost = BigInt(rows) * rate;
	const res = await debitCredits(db, credited.accountId, cost);
	if (res.ok) await recordCreditsSpend(db, credited.accountId, cost);
}
