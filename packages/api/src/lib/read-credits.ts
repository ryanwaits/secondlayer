import { randomUUID } from "node:crypto";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	MIN_CREDITED_USD_MICROS,
	isOverMonthlyCreditCap,
} from "@secondlayer/platform/billing/prices";
import {
	getCredits,
	getMonthlyCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
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
 * governs the rate-limit bypass only, not whether a read is metered). A short
 * balance writes the ledger row with `debited: false` rather than serving the
 * read silently free; it does not block the response, which has already been
 * sent by the time this runs.
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
