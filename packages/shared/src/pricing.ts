/**
 * Single source of truth for plan tiers — capacity, price, display copy,
 * Stripe binding, and container allocations.
 *
 * Consumed by:
 *   - Provisioner (`packages/provisioner/src/plans.ts` re-exports)
 *   - API (`/api/accounts/usage` for allowance math + display)
 *   - Web app (`/billing` page renders plan cards from this)
 *
 * Adding a tier? Add an entry to PLANS. Removing one? Drop here, run
 * the Stripe-side cleanup (archive lookup_key), and update env vars.
 */

const BYTES_PER_GB: number = 1024 ** 3;

export type AccountPlanId = "none" | PlanId;
export type PlanId = "launch" | "scale" | "enterprise";

export interface ContainerAlloc {
	memoryMb: number;
	cpus: number;
}

export interface Plan {
	id: PlanId;
	displayName: string;
	/** Monthly subscription price in cents. null = custom (Enterprise). */
	monthlyPriceCents: number | null;
	/** Annual subscription price in cents. null = no self-serve annual price. */
	annualPriceCents: number | null;
	totalCpus: number;
	totalMemoryMb: number;
	/** Hard cap. -1 = unlimited (Enterprise). Storage overage bills past this. */
	storageLimitMb: number;
	containers: {
		postgres: ContainerAlloc;
		api: ContainerAlloc;
		processor: ContainerAlloc;
	};
	/** Display-only. Marketing/short pitch. */
	tagline: string;
	/** Display-only. Bullet list on the plan card. */
	features: string[];
	/** Stripe `lookup_key` for monthly recurring tier price. null for enterprise. */
	stripeLookupKey: string | null;
	/** Stripe `lookup_key` for annual recurring tier price. null for enterprise. */
	stripeAnnualLookupKey: string | null;
}

// ── Allocation helpers ──────────────────────────────────────────────
//
// Allocation within a plan (3 containers per tenant):
//   Default split (paid tiers)   — PG 50% / proc 30% / api 20%
//   Sub-1GB total                — PG 60% / proc 25% / api 15%
//
// Docker memory limit is a hard cap (OOM kill on overage). CPU is a soft
// cap via `--cpus` (throttling, not killing). Storage is monitored
// separately and billed as overage — PG crashes if we hard-cap it.

function alloc(totalMb: number, totalCpus: number): Plan["containers"] {
	return {
		postgres: {
			memoryMb: Math.floor(totalMb * 0.5),
			cpus: round2(totalCpus * 0.5),
		},
		processor: {
			memoryMb: Math.floor(totalMb * 0.3),
			cpus: round2(totalCpus * 0.3),
		},
		api: {
			memoryMb: Math.floor(totalMb * 0.2),
			cpus: round2(totalCpus * 0.2),
		},
	};
}

function allocTight(totalMb: number, totalCpus: number): Plan["containers"] {
	return {
		postgres: {
			memoryMb: Math.floor(totalMb * 0.6),
			cpus: round2(totalCpus * 0.6),
		},
		processor: {
			memoryMb: Math.floor(totalMb * 0.25),
			cpus: round2(totalCpus * 0.25),
		},
		api: {
			memoryMb: Math.floor(totalMb * 0.15),
			cpus: round2(totalCpus * 0.15),
		},
	};
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Split a compute envelope across (postgres, processor, api) containers.
 * Auto-biases PG-heavy (60/25/15) for sub-1GB totals.
 */
export function allocForTotals(
	totalMemoryMb: number,
	totalCpus: number,
): Plan["containers"] {
	return totalMemoryMb < 1024
		? allocTight(totalMemoryMb, totalCpus)
		: alloc(totalMemoryMb, totalCpus);
}

// ── Canonical plan data ─────────────────────────────────────────────

export const PLANS: Record<PlanId, Plan> = {
	launch: {
		id: "launch",
		displayName: "Launch",
		monthlyPriceCents: 9_900, // $99
		annualPriceCents: 99_000, // 2 months free
		totalCpus: 2,
		totalMemoryMb: 6_144,
		storageLimitMb: 102_400, // 100 GB
		containers: alloc(6_144, 2),
		tagline: "Real product",
		features: [
			"2 vCPU · 6 GB RAM",
			"100 GB storage · always-on",
			"3-5 contracts",
			"Production reindex windows",
			"Spend caps + alerts",
			"Email support",
		],
		stripeLookupKey: "secondlayer_launch_monthly",
		stripeAnnualLookupKey: "secondlayer_launch_yearly",
	},
	scale: {
		id: "scale",
		displayName: "Scale",
		monthlyPriceCents: 29_900, // $299
		annualPriceCents: 299_000, // 2 months free
		totalCpus: 8,
		totalMemoryMb: 24_576,
		storageLimitMb: 512_000, // 500 GB
		containers: alloc(24_576, 8),
		tagline: "Full indexing",
		features: [
			"8 vCPU · 24 GB RAM",
			"500 GB storage · always-on",
			"Heavy history + replay",
			"24h SLA · priority support",
		],
		stripeLookupKey: "secondlayer_scale_monthly",
		stripeAnnualLookupKey: "secondlayer_scale_yearly",
	},
	enterprise: {
		id: "enterprise",
		displayName: "Enterprise",
		monthlyPriceCents: null,
		annualPriceCents: null,
		totalCpus: 16,
		totalMemoryMb: 65_536,
		storageLimitMb: -1,
		containers: alloc(65_536, 16),
		tagline: "Whatever needed",
		features: [
			"Custom compute + storage",
			"SLAs · regions · SSO",
			"Dedicated success engineer",
		],
		stripeLookupKey: null,
		stripeAnnualLookupKey: null,
	},
};

export const PLAN_IDS: readonly PlanId[] = ["launch", "scale", "enterprise"];

export function getPlan(id: string): Plan {
	const plan = (PLANS as Record<string, Plan | undefined>)[id];
	if (!plan) throw new Error(`Unknown plan: ${id}`);
	return plan;
}

export function isValidPlanId(id: string): id is PlanId {
	return id in PLANS;
}

// ── Allowance helpers (used by /api/accounts/usage display) ─────────
//
// Compute is hard-capped by Docker `--cpus`, so there's no compute
// overage billing. The function below returns ∞ for paid plans (display-
// only — no metering).
//
// Storage IS metered and billed past the plan's allowance via the
// `storage_gb_months` Stripe meter at $2/GB-mo.

export function getComputeAllowanceHours(_plan: string): number {
	// Compute overage was killed when we removed the `compute_hours` meter.
	// All plans are now hard-capped by Docker `--cpus`. ∞ here means "no
	// overage tracked" for display purposes.
	return Number.POSITIVE_INFINITY;
}

export function getStorageAllowanceBytes(plan: string): number {
	const planDef = (PLANS as Record<string, Plan | undefined>)[plan];
	if (!planDef) return 0;
	if (planDef.storageLimitMb < 0) return Number.POSITIVE_INFINITY;
	return planDef.storageLimitMb * 1024 * 1024;
}

/** Paid tiers bill $2/GB over allowance. Accounts with no plan do not accrue overage. */
export function hasStorageOverage(plan: string): boolean {
	return plan !== "none" && plan !== "enterprise";
}

export function getBasePriceCents(plan: string): number {
	const planDef = (PLANS as Record<string, Plan | undefined>)[plan];
	return planDef?.monthlyPriceCents ?? 0;
}

export function getPlanDisplayName(plan: string): string {
	const planDef = (PLANS as Record<string, Plan | undefined>)[plan];
	return planDef?.displayName ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

// Re-export bytes-per-GB constant for callers that compute display values.
export { BYTES_PER_GB };
