/**
 * The one price table. Every billable unit's price lives here, in
 * USD-micros (1 USD = 1,000,000 µ$ — matches `usdToMicros` in
 * `db/queries/account-credits.ts`). `meter()` (`./meter.ts`) is the only
 * function that reads this table to price a charge; nothing else should
 * hardcode a price.
 *
 * A pipeline priced by rows delivered, not a query service (founder,
 * 2026-09-24): the hosted feed charges the same per row whether it's the
 * live tip or history. The archive is the bulk discount for the whole
 * chain, not a separate pricing surface.
 */

export type MeterUnit =
	| "archive.partition"
	| "archive.partition.events"
	| "rows.delivered"
	| "memory.gb_hour"
	| "storage.gb_day"
	| "webhook.event";

/** Flat price per unit of quantity, in USD-micros. `rows.delivered` has its
 *  own volume-tier + monthly-allowance logic in `meter.ts`; every other unit
 *  is `PRICES[unit] * quantity`, no tiers. */
export const PRICES: Record<MeterUnit, bigint> = {
	// Archive fetch gate (design-f089). Unchanged from `routes/archive.ts`.
	"archive.partition": 50_000n,
	"archive.partition.events": 150_000n,

	// Hosted Index/Streams reads. Base rate; see CREDIT_USD_MICROS_PER_ROW_VOLUME
	// for the commit-tier rate past COMMIT_TIER_MONTHLY_USD_MICROS.
	"rows.delivered": 5n,

	// Hosted stack meters (044/046 provisioner). Not wired to a caller yet —
	// the price exists so /internal/meters and the usage view are ready the
	// day the provisioner ships.
	"memory.gb_hour": 28_000n, // ~$0.028/GB-hour, ~$20/GB-month (founder 2026-09-24)
	"storage.gb_day": 8_333n, // ~$0.25/GB-month billed daily (250_000n / 30)
	"webhook.event": 10n, // $10/1M events; retries are free (never metered)
};

/** $5 per 1M rows read = 5 USD-micros per row. Same value as `PRICES["rows.delivered"]`,
 *  exported under its historical name for existing callers. */
export const CREDIT_USD_MICROS_PER_ROW: bigint = PRICES["rows.delivered"];

/** Commit-tier rate for `rows.delivered` once this month's ledger total
 *  (dollars, not rows) reaches `COMMIT_TIER_MONTHLY_USD_MICROS`. */
export const CREDIT_USD_MICROS_PER_ROW_VOLUME = 2n;

/** Monthly-spend threshold for the commit-tier rate: $50 = 50M µ$. */
export const COMMIT_TIER_MONTHLY_USD_MICROS = 50_000_000n;

/** First N `rows.delivered` per account per UTC calendar month are free
 *  (founder 2026-09-24) — replaces the old free height window. */
export const ROWS_DELIVERED_MONTHLY_ALLOWANCE = 10_000_000;

/**
 * Minimum balance to take a debit for one page: one full page (1000 rows ×
 * 5µ$ = 5000µ$ = $0.005). Kept as the PAYG-unthrottle threshold
 * (`resolveCreditedAccount`) — a below-a-page balance still gets the
 * monthly allowance, it just doesn't buy the rate-limit bypass.
 */
export const MIN_CREDITED_USD_MICROS = 5_000n;

/** Batch cap for `POST /internal/meters` — the workload host pages larger
 *  submissions across calls. */
export const MAX_METER_BATCH = 500;

/** Stripe/cap dimensions are stored in cents; ledger amounts in USD-micros. */
export const USD_MICROS_PER_CENT = 10_000n;

/**
 * Has this month's `rows.delivered` spend reached the account's configured
 * monthly cap? `null` cap = no cap = never over. `meter()` calls this before
 * debiting a `rows.delivered` charge — the real-time gate that makes
 * `account_spend_caps.monthly_cap_cents` actually bite; the daily cron
 * (`spend-cap-alert.ts`) only mirrors the same comparison into `frozen_at` +
 * an email.
 */
export function isOverMonthlyCreditCap(
	spentUsdMicros: bigint,
	monthlyCapCents: number | null,
): boolean {
	if (monthlyCapCents == null) return false;
	return spentUsdMicros >= BigInt(monthlyCapCents) * USD_MICROS_PER_CENT;
}
