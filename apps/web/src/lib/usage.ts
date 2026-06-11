// Client-side types for the `/api/accounts/usage` response.
// Kept in a shared lib so the page + extracted components agree on shape.

export interface SparklinePoint {
	day: string;
	value: number;
}

export interface UsagePeriod {
	startIso: string;
	endIso: string;
	daysRemaining: number;
	daysElapsed: number;
}

export interface UsagePlan {
	tier: string;
	name: string;
	basePriceUsd: number;
}

export interface UsageSpend {
	currentCents: number;
	projectedCents: number;
	capCents: number | null;
	thresholdPct: number;
	thresholdHit: boolean;
	frozen: boolean;
}

export interface UsageResponse {
	period: UsagePeriod;
	plan: UsagePlan;
	spend: UsageSpend;
}

// ── Formatters ──────────────────────────────────────────────────────

export function formatCents(cents: number): string {
	const dollars = cents / 100;
	return dollars.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

export function formatNum(n: number): string {
	return n.toLocaleString("en-US");
}
