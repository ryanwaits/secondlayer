/**
 * Runway + level math (Design's Definitions section), shared by the
 * balance-alert cron (`packages/worker/src/jobs/balance-alert.ts`) and
 * mirrored — pure, no DB — in `apps/web/src/lib/usage.ts` for the credits
 * page. Kept here too so the cron never has to import web code to agree
 * with what the page shows.
 */

export type ServiceState = "running" | "stopped" | "none";
export type BalanceLevel = "ok" | "low" | "crit" | "stopped";

/** `balance / rateDay`, in days. `Infinity` when `rateDay <= 0` — nothing is
 *  burning, so there's no runway to run out of. */
export function runwayDays(
	balanceUsdMicros: bigint,
	rateDayUsdMicros: bigint,
): number {
	if (rateDayUsdMicros <= 0n) return Number.POSITIVE_INFINITY;
	return Number(balanceUsdMicros) / Number(rateDayUsdMicros);
}

/** `stopped` if the hosted stack is stopped and the balance is at or
 *  below $0; else `crit` at ≤2 days of runway, `low` at ≤7, otherwise `ok`.
 *  A service that's `none` (never ran) with no spend has `Infinity` runway,
 *  which falls through to `ok`, matching Design ("no service and no spend →
 *  ok"). */
export function balanceLevel(opts: {
	serviceState: ServiceState;
	balanceUsdMicros: bigint;
	runwayDays: number;
}): BalanceLevel {
	if (opts.serviceState === "stopped" && opts.balanceUsdMicros <= 0n) {
		return "stopped";
	}
	if (opts.runwayDays <= 2) return "crit";
	if (opts.runwayDays <= 7) return "low";
	return "ok";
}
