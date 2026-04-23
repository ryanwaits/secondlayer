// Client-side types for the `/api/accounts/usage` response.
// Kept in a shared lib so the page + extracted components agree on shape.

export interface SparklinePoint {
	day: string;
	value: number;
}

export type TenantStatus =
	| "active"
	| "paused"
	| "provisioning"
	| "error"
	| "suspended"
	| "deleted";

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

export interface UsageAxis<U extends string = string> {
	used?: number;
	allowance?: number;
	pct: number;
	sparkline: SparklinePoint[];
	[k: string]: unknown;
}

export interface UsageCompute {
	usedHours: number;
	allowanceHours: number;
	pct: number;
	sparkline: SparklinePoint[];
}

export interface UsageStorage {
	usedBytes: number;
	allowanceBytes: number;
	pct: number;
	sparkline: SparklinePoint[];
}

export interface UsageProject {
	id: string;
	slug: string;
	name: string;
	status: TenantStatus;
	subgraphCount: number;
	compute: { hours: number; pct: number };
	storage: { bytes: number; pct: number };
}

export interface UsageResponse {
	period: UsagePeriod;
	plan: UsagePlan;
	spend: UsageSpend;
	compute: UsageCompute;
	storage: UsageStorage;
	projects: UsageProject[];
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

export function formatHours(h: number): string {
	if (h < 10) return h.toFixed(1);
	return Math.round(h).toLocaleString("en-US");
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	const gb = mb / 1024;
	if (gb < 1024) return `${gb.toFixed(1)} GB`;
	return `${(gb / 1024).toFixed(2)} TB`;
}

export function formatNum(n: number): string {
	return n.toLocaleString("en-US");
}
