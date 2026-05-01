/**
 * Plan tiers — re-exported from `@secondlayer/shared/pricing`, the
 * canonical source of truth for capacity/price/Stripe binding/display.
 *
 * Add or remove tiers there, not here. This file exists to preserve
 * the historical import path used across the provisioner.
 */
export {
	type Plan,
	type PlanId,
	type ContainerAlloc,
	PLANS,
	PLAN_IDS,
	getPlan,
	isValidPlanId,
	allocForTotals,
} from "@secondlayer/shared/pricing";
