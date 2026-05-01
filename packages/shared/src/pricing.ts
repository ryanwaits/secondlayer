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

const BYTES_PER_GB = 1024 ** 3;

export type PlanId = "hobby" | "launch" | "scale" | "enterprise";

export interface ContainerAlloc {
	memoryMb: number;
	cpus: number;
}

export interface Plan {
	id: PlanId;
	displayName: string;
	/** Monthly subscription price in cents. null = custom (Enterprise). */
	monthlyPriceCents: number | null;
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
	/** Stripe `lookup_key` for the recurring tier price. null for hobby/enterprise. */
	stripeLookupKey: string | null;
}

// ── Allocation helpers ──────────────────────────────────────────────
//
// Allocation within a plan (3 containers per tenant):
//   Default split (paid tiers)   — PG 50% / proc 30% / api 20%
//   Sub-1GB total (Hobby)        — PG 60% / proc 25% / api 15%
//
// Biased toward PG on Hobby because PG 17's default `shared_buffers` is
// 128MB — a naive 50/30/20 split on 512MB leaves PG with 256MB RAM, which
// is technically workable but crashes if `shared_buffers` isn't also
// shrunk. The 60/25/15 split gives PG 307MB, more headroom.
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
	hobby: {
		id: "hobby",
		displayName: "Hobby",
		monthlyPriceCents: 0,
		totalCpus: 0.5,
		totalMemoryMb: 512,
		storageLimitMb: 5_120,
		containers: allocTight(512, 0.5),
		tagline: "Free, forever",
		features: [
			"0.5 vCPU · 512 MB RAM",
			"5 GB storage · auto-pause 7d",
			"Subgraphs + subscriptions",
			"Community support",
		],
		stripeLookupKey: null,
	},
	launch: {
		id: "launch",
		displayName: "Launch",
		monthlyPriceCents: 5_000, // $50
		totalCpus: 1,
		totalMemoryMb: 2_048,
		storageLimitMb: 25_600, // 25 GB
		containers: alloc(2_048, 1),
		tagline: "Production-ready",
		features: [
			"1 vCPU · 2 GB RAM",
			"25 GB storage · always-on",
			"Unlimited subgraphs + subscriptions",
			"Spend caps + alerts",
			"Email support",
		],
		stripeLookupKey: "secondlayer_launch_monthly",
	},
	scale: {
		id: "scale",
		displayName: "Scale",
		monthlyPriceCents: 20_000, // $200
		totalCpus: 4,
		totalMemoryMb: 8_192,
		storageLimitMb: 102_400, // 100 GB
		containers: alloc(8_192, 4),
		tagline: "Scale with confidence",
		features: [
			"4 vCPU · 8 GB RAM",
			"100 GB storage · always-on",
			"Higher throughput + replay",
			"24h SLA · priority support",
		],
		stripeLookupKey: "secondlayer_scale_monthly",
	},
	enterprise: {
		id: "enterprise",
		displayName: "Enterprise",
		monthlyPriceCents: null,
		totalCpus: 8,
		totalMemoryMb: 32_768,
		storageLimitMb: -1,
		containers: alloc(32_768, 8),
		tagline: "Custom workloads",
		features: [
			"Custom compute + storage",
			"SLAs · regions · SSO",
			"Dedicated success engineer",
		],
		stripeLookupKey: null,
	},
};

export const PLAN_IDS: readonly PlanId[] = [
	"hobby",
	"launch",
	"scale",
	"enterprise",
];

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
	if (!planDef) return PLANS.hobby.storageLimitMb * 1024 * 1024;
	if (planDef.storageLimitMb < 0) return Number.POSITIVE_INFINITY;
	return planDef.storageLimitMb * 1024 * 1024;
}

/** Hobby has a hard cap (no overage billing); paid tiers bill $2/GB over allowance. */
export function hasStorageOverage(plan: string): boolean {
	return plan !== "hobby" && plan !== "enterprise";
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
