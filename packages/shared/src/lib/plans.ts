export interface PlanLimits {
  streams: number;
  views: number;
  apiRequestsPerDay: number;
  deliveriesPerMonth: number;
  storageBytes: number;
}

export const FREE_PLAN: PlanLimits = {
  streams: 3,
  views: 2,
  apiRequestsPerDay: 1_000,
  deliveriesPerMonth: 5_000,
  storageBytes: 100 * 1024 * 1024, // 100MB
};

export function getPlanLimits(plan: string): PlanLimits {
  switch (plan) {
    case "free":
    default:
      return FREE_PLAN;
  }
}
