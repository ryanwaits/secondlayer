/**
 * Schedule cadence policy per tier.
 *
 * A cron expression can fire every second, but letting Hobby workflows
 * loop at that rate turns the free tier into a cheap cron host — which
 * it's not meant to be. Tier-floored minimum intervals push high-
 * frequency automation toward the paid tiers where compute headroom
 * actually exists.
 *
 * This module is pure TypeScript — no DB, no imports beyond types —
 * so the (currently-dead) workflow deploy path can call it without
 * dragging in a DB client.
 */

export interface SchedulePolicy {
	/** Minimum seconds between fires (inclusive). `60` = "at most once per minute". */
	minIntervalSeconds: number;
}

const SCHEDULE_POLICY_BY_PLAN: Record<string, SchedulePolicy> = {
	hobby: { minIntervalSeconds: 5 * 60 }, // 5 min floor — fair-use on free tier
	launch: { minIntervalSeconds: 60 }, // 1 min
	grow: { minIntervalSeconds: 60 },
	scale: { minIntervalSeconds: 10 }, // 10s on scale and up
	enterprise: { minIntervalSeconds: 1 },
};

export function getSchedulePolicyForPlan(plan: string): SchedulePolicy {
	// Unknown plan → Hobby floor so a stray DB value can't bypass the cap.
	return SCHEDULE_POLICY_BY_PLAN[plan] ?? SCHEDULE_POLICY_BY_PLAN.hobby;
}

/**
 * Parse a cron expression and return the smallest interval (seconds)
 * it can fire at. Conservative: for any field that's a list (e.g.
 * `*` or `1,2,3` in minutes), we compute the tightest gap between
 * enumerated values. Step syntax (`*\/5`) is handled.
 *
 * Minimal 5-field cron parser (minute hour dom month dow). No seconds
 * field. Returns `null` if the expression can't be parsed — caller
 * should treat that as invalid.
 */
export function minCronIntervalSeconds(expr: string): number | null {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	const [minuteField] = parts;
	const minuteVals = expandCronField(minuteField, 0, 59);
	if (!minuteVals) return null;

	if (minuteVals.length === 1) {
		// Single minute value → fires at most once per hour unless other
		// fields narrow further. 1h is the tightest plausible gap here and
		// a safe lower bound for enforcement (> Hobby's 5-min floor, so
		// hourly schedules pass cleanly).
		return 60 * 60;
	}
	const sorted = [...minuteVals].sort((a, b) => a - b);
	let minGap = Number.POSITIVE_INFINITY;
	for (let i = 1; i < sorted.length; i++) {
		minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
	}
	// Wrap gap — e.g. minutes [0,30,45] → gaps 30, 15, (60-45+0)=15 → min 15
	const wrap = 60 - sorted[sorted.length - 1] + sorted[0];
	minGap = Math.min(minGap, wrap);
	return minGap * 60;
}

function expandCronField(
	field: string,
	min: number,
	max: number,
): number[] | null {
	if (field === "*") {
		const out: number[] = [];
		for (let i = min; i <= max; i++) out.push(i);
		return out;
	}
	const out = new Set<number>();
	for (const part of field.split(",")) {
		const step = part.includes("/") ? Number(part.split("/")[1]) : 1;
		const range = part.split("/")[0];
		let lo: number;
		let hi: number;
		if (range === "*") {
			lo = min;
			hi = max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-").map(Number);
			if (Number.isNaN(a) || Number.isNaN(b)) return null;
			lo = a;
			hi = b;
		} else {
			const n = Number(range);
			if (Number.isNaN(n)) return null;
			lo = n;
			hi = n;
		}
		if (Number.isNaN(step) || step < 1) return null;
		for (let i = lo; i <= hi; i += step) {
			if (i >= min && i <= max) out.add(i);
		}
	}
	return [...out];
}

export interface ScheduleValidationResult {
	ok: boolean;
	reason?: string;
	policy?: SchedulePolicy;
	observedIntervalSeconds?: number;
}

/**
 * Validate that a cron expression's tightest interval fits the tenant's
 * plan. Called at workflow deploy time — rejections produce a clean
 * error with the offending tier + the required minimum interval.
 */
export function validateWorkflowSchedule(
	plan: string,
	cronExpr: string,
): ScheduleValidationResult {
	const policy = getSchedulePolicyForPlan(plan);
	const interval = minCronIntervalSeconds(cronExpr);
	if (interval === null) {
		return {
			ok: false,
			reason: `Could not parse cron expression: "${cronExpr}"`,
			policy,
		};
	}
	if (interval < policy.minIntervalSeconds) {
		return {
			ok: false,
			reason: `Schedule fires every ${interval}s; ${plan} tier requires at least ${policy.minIntervalSeconds}s between runs. Upgrade or relax the cron.`,
			policy,
			observedIntervalSeconds: interval,
		};
	}
	return { ok: true, policy, observedIntervalSeconds: interval };
}
