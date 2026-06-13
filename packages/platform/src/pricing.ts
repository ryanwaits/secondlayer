/**
 * Single source of truth for plan tiers — price, display copy, and Stripe
 * binding. Plans sell limits on shared infrastructure (rate tiers, private
 * subgraphs, genesis backfill); the per-tenant container vocabulary that
 * used to live here died with dedicated provisioning.
 *
 * Rate-limit numbers themselves live with their enforcement:
 * `@secondlayer/api` index/streams tier configs.
 *
 * Adding a tier? Add an entry to PLANS. Removing one? Drop here, run
 * the Stripe-side cleanup (archive lookup_key), and update env vars.
 */

const BYTES_PER_GB: number = 1024 ** 3;

export type AccountPlanId = "none" | PlanId;
export type PlanId = "launch" | "scale" | "enterprise";

export interface Plan {
	id: PlanId;
	displayName: string;
	/** Monthly subscription price in cents. null = custom (Enterprise). */
	monthlyPriceCents: number | null;
	/** Annual subscription price in cents. null = no self-serve annual price. */
	annualPriceCents: number | null;
	/** Display-only. Marketing/short pitch. */
	tagline: string;
	/** Display-only. Bullet list on the plan card. */
	features: string[];
	/** Stripe `lookup_key` for monthly recurring tier price. null for enterprise. */
	stripeLookupKey: string | null;
	/** Stripe `lookup_key` for annual recurring tier price. null for enterprise. */
	stripeAnnualLookupKey: string | null;
}

// ── Canonical plan data ─────────────────────────────────────────────

export const PLANS: Record<PlanId, Plan> = {
	launch: {
		// Historical id kept for Stripe lookup-key + DB continuity; every
		// user-facing surface says "Pro".
		id: "launch",
		displayName: "Pro",
		monthlyPriceCents: 7_900, // $79
		annualPriceCents: 79_000, // 2 months free
		tagline: "Real product",
		features: [
			"250 req/s on Index and Streams",
			"Private subgraphs",
			"Genesis backfills (full history)",
			"25 webhook subscriptions + replay",
			"Usage budgets + alerts",
			"Email support",
		],
		stripeLookupKey: "secondlayer_launch_monthly",
		stripeAnnualLookupKey: "secondlayer_launch_yearly",
	},
	scale: {
		// Not self-serve: sold via contact-sales / manual deals only.
		id: "scale",
		displayName: "Scale",
		monthlyPriceCents: 29_900, // $299
		annualPriceCents: 299_000, // 2 months free
		tagline: "Full indexing",
		features: [
			"500 req/s on Index and Streams",
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
		tagline: "Whatever needed",
		features: [
			"Custom rates + dedicated capacity",
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
