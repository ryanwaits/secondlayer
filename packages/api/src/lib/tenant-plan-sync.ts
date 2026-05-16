import type { UpgradeableTier } from "./tier-mapping.ts";

type SyncResult =
	| { status: "resized"; from: string; to: UpgradeableTier; slug: string }
	| { status: "noop"; reason: string; slug?: string };

/**
 * Tenant plan sync is dormant post 2026-05-14 shared-rip — there are no
 * per-tenant resources to resize. Stripe-dormant code paths still import this
 * so they compile; restore a real impl when paid tiers come back.
 */
export async function syncTenantToPaidPlan(_input: {
	accountId: string;
	targetPlan: UpgradeableTier;
	actor: string;
	reason: string;
}): Promise<SyncResult> {
	return { status: "noop", reason: "shared_mode" };
}
