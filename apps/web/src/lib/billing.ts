// Shape of GET /api/billing/caps (as exposed by packages/api/src/routes/billing.ts)
export interface BillingCaps {
	monthlyCapCents: number | null;
	computeCapCents: number | null;
	storageCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
}

export type BillingTier = "none" | "launch" | "scale" | "enterprise";
