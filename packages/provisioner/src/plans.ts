/**
 * Compute plan definitions for dedicated hosting.
 *
 * Allocation within a plan (3 containers per tenant):
 *   Default split (paid tiers)   — PG 50% / proc 30% / api 20%
 *   Sub-1GB total (Hobby)        — PG 60% / proc 25% / api 15%
 *
 * Biased toward PG on Hobby because PG 17's default `shared_buffers` is
 * 128MB — a naive 50/30/20 split on 512MB leaves PG with 256MB RAM, which
 * is technically workable but crashes if `shared_buffers` isn't also
 * shrunk. The 60/25/15 split gives PG 307MB, more headroom at the cost of
 * slightly tighter proc/api.
 *
 * Docker memory limit is a hard cap (OOM kill on overage). CPU is a soft
 * cap via `--cpus` (throttling, not killing). Storage is monitored
 * separately and billed as overage — PG crashes if we hard-cap it.
 */

export type PlanId = "hobby" | "launch" | "grow" | "scale" | "enterprise";

export interface ContainerAlloc {
	memoryMb: number;
	cpus: number;
}

export interface Plan {
	id: PlanId;
	displayName: string;
	monthlyPriceUsd: number | null; // null = custom pricing (enterprise)
	totalCpus: number;
	totalMemoryMb: number;
	storageLimitMb: number; // -1 = unlimited (enterprise)
	containers: {
		postgres: ContainerAlloc;
		api: ContainerAlloc;
		processor: ContainerAlloc;
	};
}

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

/** Biased split for sub-1GB plans. See header comment for rationale. */
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

export const PLANS: Record<PlanId, Plan> = {
	hobby: {
		id: "hobby",
		displayName: "Hobby",
		monthlyPriceUsd: 0,
		totalCpus: 0.5,
		totalMemoryMb: 512,
		storageLimitMb: 5120,
		containers: allocTight(512, 0.5),
	},
	launch: {
		id: "launch",
		displayName: "Launch",
		monthlyPriceUsd: 99,
		totalCpus: 1,
		totalMemoryMb: 2048,
		storageLimitMb: 10240,
		containers: alloc(2048, 1),
	},
	grow: {
		id: "grow",
		displayName: "Grow",
		monthlyPriceUsd: 249,
		totalCpus: 2,
		totalMemoryMb: 4096,
		storageLimitMb: 51200,
		containers: alloc(4096, 2),
	},
	scale: {
		id: "scale",
		displayName: "Scale",
		monthlyPriceUsd: 599,
		totalCpus: 4,
		totalMemoryMb: 8192,
		storageLimitMb: 204800,
		containers: alloc(8192, 4),
	},
	enterprise: {
		id: "enterprise",
		displayName: "Enterprise",
		monthlyPriceUsd: null,
		totalCpus: 8,
		totalMemoryMb: 32_768,
		storageLimitMb: -1,
		containers: alloc(32_768, 8),
	},
};

export function getPlan(id: string): Plan {
	const plan = (PLANS as Record<string, Plan | undefined>)[id];
	if (!plan) throw new Error(`Unknown plan: ${id}`);
	return plan;
}

export function isValidPlanId(id: string): id is PlanId {
	return id in PLANS;
}

/**
 * Split a compute envelope across (postgres, processor, api) containers.
 * Auto-biases to PG-heavy (60/25/15) for sub-1GB totals so PG 17's default
 * `shared_buffers` has headroom. Used by `resizeTenant` when the caller
 * passes explicit compute (plan base + add-ons), not just a plan id.
 */
export function allocForTotals(
	totalMemoryMb: number,
	totalCpus: number,
): Plan["containers"] {
	return totalMemoryMb < 1024
		? allocTight(totalMemoryMb, totalCpus)
		: alloc(totalMemoryMb, totalCpus);
}
