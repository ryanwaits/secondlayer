import type { BudgetPeriod } from "@secondlayer/workflows";

/**
 * Period key derivation for `workflow_budgets`. All timestamps interpreted
 * in UTC — budgets reset uniformly regardless of runner geography.
 *
 * Returns `{ period, resetAt }` so the enforcer can write the row with a
 * fresh `reset_at` on first use, and the reset cron can upsert new rows at
 * period boundaries.
 */
export interface Period {
	key: string;
	resetAt: Date;
}

export function currentPeriod(
	reset: BudgetPeriod,
	now: Date,
	runId?: string,
): Period {
	switch (reset) {
		case "daily":
			return daily(now);
		case "weekly":
			return weekly(now);
		case "per-run":
			if (!runId) {
				throw new Error(
					'budget.reset = "per-run" requires a runId at period derivation',
				);
			}
			return perRun(runId);
		default:
			// Default daily if caller misconfigures.
			return daily(now);
	}
}

function daily(now: Date): Period {
	const y = now.getUTCFullYear();
	const m = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const resetAt = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
	);
	return { key: `daily:${y}-${m}-${d}`, resetAt };
}

function weekly(now: Date): Period {
	// ISO week: Monday is day 1. Anchor to the Monday of the current week.
	const date = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const day = date.getUTCDay() || 7;
	if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
	// ISO week number via RFC 5440 approach.
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(
		((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
	);
	const key = `weekly:${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
	const resetAt = new Date(date);
	resetAt.setUTCDate(resetAt.getUTCDate() + 7);
	return { key, resetAt };
}

function perRun(runId: string): Period {
	// Reset at an arbitrary far-future date — "per-run" periods are finalised
	// when the run completes, never by cron.
	return { key: `per-run:${runId}`, resetAt: new Date("9999-12-31T00:00:00Z") };
}
