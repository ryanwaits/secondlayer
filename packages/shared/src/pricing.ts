// ── Per-tier compute + storage allowances (usage page) ──────────────
//
// "Included" amounts per billing period. Actual billing comes from
// Stripe compute-hours + storage-overage meters; these constants power
// the dashboard display and the approximation used by `/api/accounts/usage`.
//
// Values picked to match `project_supabase_pricing_model.md`:
//   Hobby — 50 h / 5 GB  (Nano — free tier)
//   Launch — 500 h / 50 GB  ($149/mo)
//   Grow — 1,000 h / 200 GB  ($349/mo)
//   Scale — 2,500 h / 1 TB  ($799/mo)
//   Enterprise — ∞ / ∞

const BYTES_PER_GB = 1024 ** 3;

// Hobby has no compute-hour cap — auto-pause after 7d idle is the cap.
// Paid tiers bill Stripe-metered hours past the included credit; the
// hour equivalents below are approximate display values. Real billing
// uses the `compute_hours` meter in Stripe, not these numbers.
const COMPUTE_ALLOWANCE_BY_PLAN: Record<string, number> = {
	hobby: Number.POSITIVE_INFINITY,
	launch: 500,
	grow: 1000,
	scale: 2500,
	enterprise: Number.POSITIVE_INFINITY,
};

const STORAGE_ALLOWANCE_BYTES_BY_PLAN: Record<string, number> = {
	hobby: 5 * BYTES_PER_GB,
	launch: 50 * BYTES_PER_GB,
	grow: 200 * BYTES_PER_GB,
	scale: 1000 * BYTES_PER_GB,
	enterprise: Number.POSITIVE_INFINITY,
};

/** Included compute hours per billing period. Unknown → hobby. */
export function getComputeAllowanceHours(plan: string): number {
	return COMPUTE_ALLOWANCE_BY_PLAN[plan] ?? COMPUTE_ALLOWANCE_BY_PLAN.hobby;
}

/** Included storage bytes. Unknown → hobby. */
export function getStorageAllowanceBytes(plan: string): number {
	return (
		STORAGE_ALLOWANCE_BYTES_BY_PLAN[plan] ??
		STORAGE_ALLOWANCE_BYTES_BY_PLAN.hobby
	);
}

/** Whether this plan bills storage overage. Hobby has a hard cap
 *  (no overage billing); paid tiers bill $2/GB over allowance. */
export function hasStorageOverage(plan: string): boolean {
	return plan !== "hobby";
}

/** Base monthly price for a plan, in cents. Enterprise is custom → 0. */
const BASE_PRICE_CENTS_BY_PLAN: Record<string, number> = {
	hobby: 0,
	launch: 14900,
	grow: 34900,
	scale: 79900,
	enterprise: 0,
};

export function getBasePriceCents(plan: string): number {
	return BASE_PRICE_CENTS_BY_PLAN[plan] ?? 0;
}

/** Capitalized display name for a plan tier. */
export function getPlanDisplayName(plan: string): string {
	return plan.charAt(0).toUpperCase() + plan.slice(1);
}
