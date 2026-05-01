// Shape of GET /api/billing/caps (as exposed by packages/api/src/routes/billing.ts)
export interface BillingCaps {
	monthlyCapCents: number | null;
	computeCapCents: number | null;
	storageCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
}

// Plan tiers re-exported from the canonical source so every dashboard
// surface reads the same record. Add tiers in `@secondlayer/shared/pricing`.
export {
	type Plan,
	type PlanId,
	type PlanId as BillingTier,
	PLANS,
	PLAN_IDS,
	getPlan,
	isValidPlanId,
} from "@secondlayer/shared/pricing";
