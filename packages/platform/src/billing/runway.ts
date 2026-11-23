/**
 * Runway + level math (Design's Definitions section), shared by the
 * balance-alert cron (`packages/worker/src/jobs/balance-alert.ts`) and
 * mirrored — pure, no DB — in `apps/web/src/lib/usage.ts` for the credits
 * page. Kept here too so the cron never has to import web code to agree
 * with what the page shows.
 */

import {
	type ServiceState,
	isBillingStop,
} from "../db/queries/hosted-stack-state.ts";

export type BalanceLevel = "ok" | "low" | "crit" | "stopped";

export function runwayDays(
	balanceUsdMicros: bigint,
	rateDayUsdMicros: bigint,
): number {
	if (rateDayUsdMicros <= 0n) return Number.POSITIVE_INFINITY;
	return Number(balanceUsdMicros) / Number(rateDayUsdMicros);
}

export function balanceLevel(opts: {
	serviceState: ServiceState;
	balanceUsdMicros: bigint;
	runwayDays: number;
}): BalanceLevel {
	if (isBillingStop(opts.serviceState) && opts.balanceUsdMicros <= 0n) {
		return "stopped";
	}
	if (opts.runwayDays <= 2) return "crit";
	if (opts.runwayDays <= 7) return "low";
	return "ok";
}
