// Shape of GET /api/billing/caps (as exposed by packages/api/src/routes/billing.ts)
export interface BillingCaps {
	monthlyCapCents: number | null;
	computeCapCents: number | null;
	storageCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
}

export type BillingTier = "hobby" | "launch" | "grow" | "scale" | "enterprise";

export interface TierMeta {
	tier: BillingTier;
	name: string;
	priceUsd: number;
	tagline: string;
	features: string[];
}

// Static copy. Mirrors `pricing.ts` allowances + the Supabase-pricing memo.
export const TIER_META: Record<Exclude<BillingTier, "enterprise">, TierMeta> = {
	hobby: {
		tier: "hobby",
		name: "Hobby",
		priceUsd: 0,
		tagline: "Free, forever",
		features: [
			"1 project · Nano compute",
			"5 GB storage · auto-pause 7d",
			"Subgraphs + subscriptions",
			"Community support",
		],
	},
	launch: {
		tier: "launch",
		name: "Launch",
		priceUsd: 149,
		tagline: "Production-ready",
		features: [
			"Unlimited projects",
			"500 h compute · 50 GB storage",
			"Subgraph subscriptions + replay",
			"Spend caps + alerts",
			"Email support",
		],
	},
	grow: {
		tier: "grow",
		name: "Grow",
		priceUsd: 349,
		tagline: "Scale with confidence",
		features: [
			"2× Launch compute + storage",
			"Higher subscription throughput",
			"24h SLA",
			"Priority support",
		],
	},
	scale: {
		tier: "scale",
		name: "Scale",
		priceUsd: 799,
		tagline: "High-throughput workloads",
		features: [
			"5× Launch compute + storage",
			"High-volume subgraph hosting",
			"1h SLA",
			"Dedicated success engineer",
		],
	},
};
