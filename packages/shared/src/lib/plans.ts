export interface PlanLimits {
	subgraphs: number;
	apiRequestsPerDay: number;
	deliveriesPerMonth: number;
	storageBytes: number;
}

export const FREE_PLAN: PlanLimits = {
	subgraphs: 2,
	apiRequestsPerDay: 1_000,
	deliveriesPerMonth: 5_000,
	storageBytes: 100 * 1024 * 1024,
};

export function getPlanLimits(plan: string): PlanLimits {
	switch (plan) {
		case "free":
		default:
			return FREE_PLAN;
	}
}
