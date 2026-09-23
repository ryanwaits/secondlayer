import {
	debitCredits,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";

/**
 * Shared pay-as-you-go read metering for Index + Streams. A free-tier account
 * that topped up prepaid credits reads beyond the free window, unthrottled, and
 * pays per row. One `account_credits` balance covers both surfaces.
 */

/** $5 per 1M rows read = 5 USD-micros per row. */
export const CREDIT_USD_MICROS_PER_ROW = 5n;

/** $2 per 1M rows — commit-tier rate for accounts spending ≥$50/mo (≈10M rows). */
export const CREDIT_USD_MICROS_PER_ROW_VOLUME = 2n;

/** Monthly-spend threshold for the commit-tier rate: $50 = 50M µ$. */
export const COMMIT_TIER_MONTHLY_USD_MICROS = 50_000_000n;

/**
 * Minimum balance to go pay-as-you-go: one full page (1000 rows × 5µ$ = 5000µ$
 * = $0.005). Gating at the max single-page cost guarantees the post-read debit
 * always covers the rows served (cost ≤ this ≤ balance), so there's no
 * dust-balance loophole where an under-a-page balance serves free forever.
 */
export const MIN_CREDITED_USD_MICROS = 5_000n;

export type Credited = { accountId: string; balance: bigint };

/**
 * The last day of blocks is free on both surfaces: the Index free window and
 * the Streams free retention are this same span. Topping up credits must never
 * make those rows cost money, so the debit counts only rows below it.
 */
export const FREE_READ_WINDOW_BLOCKS = STREAMS_BLOCKS_PER_DAY;

/**
 * Rows a credited caller pays for: those at a height below `tip - window`.
 * A row with no height (mempool) is current by definition, so it is free.
 * No known tip charges every row, the pre-window behavior, rather than
 * guessing a cutoff.
 */
export function billableRowCount(
	rows: readonly unknown[],
	tipHeight: number | undefined,
): number {
	if (tipHeight === undefined) return rows.length;
	const cutoff = Math.max(0, tipHeight - FREE_READ_WINDOW_BLOCKS);
	let billable = 0;
	for (const row of rows) {
		const height = rowHeight(row);
		if (height !== null && height < cutoff) billable++;
	}
	return billable;
}

function rowHeight(row: unknown): number | null {
	if (typeof row !== "object" || row === null) return null;
	const raw =
		(row as { block_height?: unknown }).block_height ??
		(row as { height?: unknown }).height;
	const height = Number(raw);
	return raw === undefined || raw === null || !Number.isFinite(height)
		? null
		: height;
}

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
 * undefined. Only free-tier account-backed callers qualify: internal
 * (first-party service) callers already have unmetered headroom; anon
 * callers have no account credits.
 *
 * Spend cap: once this month's credit spend reaches the account's monthly cap,
 * stop crediting so reads fall back to the free window — the hard stop the
 * spend-cap freeze always promised but never enforced.
 */
export async function resolveCreditedAccount(
	accountId: string | undefined,
	tier: string | undefined,
): Promise<Credited | undefined> {
	if (!isPlatformMode() || !accountId || tier === "internal") return undefined;
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
 *
 * Residual soft-cap note: `resolveCreditedAccount` checks the monthly cap
 * BEFORE serving the page; the debit happens after. Two concurrent reads can
 * each pass the cap check and each serve a page before either debits, so spend
 * can exceed the cap by at most (in-flight requests) × one-page cost (≈$0.005
 * per page). This bounded overage is intentional — balance can never go
 * negative because `debitCredits` is a conditional `WHERE balance >= cost`.
 */
export async function debitCreditedRows(
	credited: Credited | undefined,
	rows: number,
): Promise<void> {
	if (!credited || rows <= 0) return;
	await getDb()
		.transaction()
		.execute(async (trx) => {
			const monthlySpend = await getMonthlyCreditsSpend(
				trx,
				credited.accountId,
			);
			const rate =
				monthlySpend >= COMMIT_TIER_MONTHLY_USD_MICROS
					? CREDIT_USD_MICROS_PER_ROW_VOLUME
					: CREDIT_USD_MICROS_PER_ROW;
			const cost = BigInt(rows) * rate;
			const res = await debitCredits(trx, credited.accountId, cost);
			if (res.ok) await recordCreditsSpend(trx, credited.accountId, cost);
		});
}
