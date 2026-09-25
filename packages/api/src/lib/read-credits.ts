import { randomUUID } from "node:crypto";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	MIN_CREDITED_USD_MICROS,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
	isOverMonthlyCreditCap,
} from "@secondlayer/platform/billing/prices";
import {
	getCredits,
	getMonthlyCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import { monthlyQuantity } from "@secondlayer/platform/db/queries/usage-ledger";
import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";

export {
	MIN_CREDITED_USD_MICROS,
	isOverMonthlyCreditCap,
} from "@secondlayer/platform/billing/prices";

/**
 * Shared pay-as-you-go read metering for Index + Streams. Every keyed read
 * with an account meters `rows.delivered` (`@secondlayer/platform/billing/meter`):
 * the first 10M rows/month are free (the allowance), rows past it debit the
 * prepaid `account_credits` balance. One balance covers both surfaces.
 */

export type Credited = { accountId: string; balance: bigint };

/**
 * A free-tier account with enough prepaid balance → pay-as-you-go
 * (unthrottled — see `indexRateLimit`/`streamsRateLimit`), else undefined.
 * Only free-tier account-backed callers qualify: internal (first-party
 * service) callers already have unmetered headroom; anon callers have no
 * account credits. This gate no longer decides whether a read is metered —
 * `meterRowsDelivered` meters every keyed read regardless — it only decides
 * whether the rate limit is bypassed.
 *
 * Spend cap: once this month's credit spend reaches the account's monthly
 * cap, stop granting the unthrottled lane (the hard stop metering itself
 * enforces is in `meter()`).
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
 * Meter one page of rows delivered to a keyed reader. Every account_id-bearing
 * read counts against the monthly allowance and, past it, debits the balance
 * — not just accounts that have already topped up (`resolveCreditedAccount`
 * governs the rate-limit bypass only, not whether a read is metered). A read
 * that STARTS under the allowance and straddles it is always served in full;
 * only its overflow portion can come back `debited: false` if the balance is
 * short (`checkRowsAllowance` below is what stops a read from starting once
 * the account is already over the allowance with nothing left to charge — by
 * the time this runs the response is already decided, so it can only make
 * the overflow visible, never unblock or claw back what was served).
 */
export async function meterRowsDelivered(
	accountId: string,
	rows: number,
	source: string,
): Promise<void> {
	if (rows <= 0) return;
	await meter(getDb(), {
		accountId,
		unit: "rows.delivered",
		quantity: rows,
		source,
		idempotencyKey: randomUUID(),
	});
}

function topUpUrl(): string {
	return `${process.env.DASHBOARD_URL ?? "https://secondlayer.tools"}/account/credits`;
}

export type InsufficientCreditsBody = {
	error: "insufficient_credits";
	shortfall_usd_micros: number;
	hint: string;
	top_up_url: string;
};

/**
 * Pre-read gate: once a keyed account's `rows.delivered` this UTC calendar
 * month has reached the free allowance, it needs balance ≥
 * `MIN_CREDITED_USD_MICROS` (one page's worth) to keep reading — the same
 * threshold `resolveCreditedAccount` uses for the rate-limit bypass. Below
 * it, the read is refused BEFORE anything is served, with the same error
 * code the archive fetch gate's 402 uses (`routes/archive.ts`):
 * `insufficient_credits` + `shortfall_usd_micros`, plus a top-up hint/link.
 *
 * No-op (never refuses — returns `null`) for anon, internal, or self-host:
 * the allowance is an account concept, and only platform mode meters reads
 * at all. A read that starts under the allowance is never refused here even
 * if it will straddle it; see `meterRowsDelivered`.
 */
export async function checkRowsAllowance(
	accountId: string | undefined,
	tier: string | undefined,
	now: Date = new Date(),
): Promise<InsufficientCreditsBody | null> {
	if (!isPlatformMode() || !accountId || tier === "internal") return null;
	const db = getDb();
	const usedThisMonth = await monthlyQuantity(
		db,
		accountId,
		"rows.delivered",
		now,
	);
	if (usedThisMonth < ROWS_DELIVERED_MONTHLY_ALLOWANCE) return null;
	const balance = await getCredits(db, accountId);
	if (balance >= MIN_CREDITED_USD_MICROS) return null;
	return {
		error: "insufficient_credits",
		shortfall_usd_micros: Number(MIN_CREDITED_USD_MICROS - balance),
		hint: "Add usage credits to keep reading rows past the free monthly allowance.",
		top_up_url: topUpUrl(),
	};
}
