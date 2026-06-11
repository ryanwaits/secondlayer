import type { Database } from "@secondlayer/shared";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { Kysely } from "kysely";

/**
 * Genesis-backfill policy.
 *
 * Free-tier (plan 'none' — includes ghost accounts) subgraphs index forward
 * from deploy-time tip only: historical backfill is the one expensive unit
 * a free account could otherwise trigger. Paid plans get genesis. First-party
 * curated Explore subgraphs are exempted via an env allowlist so the seeding
 * account can deploy full-history views regardless of its plan row.
 *
 * Only meaningful in platform mode — oss/dedicated/local deployments are
 * single-tenant and never clamped.
 */

const EXEMPT_ENV = "SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS";

export function genesisExemptAccountIds(
	env: NodeJS.ProcessEnv = process.env,
): Set<string> {
	return new Set(
		(env[EXEMPT_ENV] ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export type GenesisPolicy = {
	genesisAllowed: boolean;
	/** Why genesis is allowed — useful in tests/logs; absent when clamped. */
	reason?: "non-platform" | "paid-plan" | "exempt-account";
};

export async function resolveGenesisPolicy(
	db: Kysely<Database>,
	accountId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): Promise<GenesisPolicy> {
	if (!isPlatformMode()) return { genesisAllowed: true, reason: "non-platform" };
	if (accountId && genesisExemptAccountIds(env).has(accountId)) {
		return { genesisAllowed: true, reason: "exempt-account" };
	}
	if (!accountId) return { genesisAllowed: false };
	const row = await db
		.selectFrom("accounts")
		.select("plan")
		.where("id", "=", accountId)
		.executeTakeFirst();
	const plan = row?.plan ?? "none";
	if (plan !== "none") return { genesisAllowed: true, reason: "paid-plan" };
	return { genesisAllowed: false };
}

export type PrivateVisibilityPolicy = {
	privateAllowed: boolean;
	reason?: "non-platform" | "paid-plan" | "exempt-account";
};

/**
 * Private-subgraph policy. Free tier (plan 'none', incl. ghosts) deploys
 * public only — private visibility is what the Pro plan sells. Gate
 * TRANSITIONS only: subgraphs that are already private stay private
 * (grandfathered), and redeploys that don't change visibility never hit
 * this check. Shares the genesis exempt-account allowlist.
 */
export async function resolvePrivateVisibilityPolicy(
	db: Kysely<Database>,
	accountId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): Promise<PrivateVisibilityPolicy> {
	if (!isPlatformMode()) return { privateAllowed: true, reason: "non-platform" };
	if (accountId && genesisExemptAccountIds(env).has(accountId)) {
		return { privateAllowed: true, reason: "exempt-account" };
	}
	if (!accountId) return { privateAllowed: false };
	const row = await db
		.selectFrom("accounts")
		.select("plan")
		.where("id", "=", accountId)
		.executeTakeFirst();
	const plan = row?.plan ?? "none";
	if (plan !== "none") return { privateAllowed: true, reason: "paid-plan" };
	return { privateAllowed: false };
}

/**
 * Webhook-subscription quota by plan. null = unlimited. Free gets enough
 * to evaluate the feature; "25 webhook subscriptions" is a Pro card claim,
 * so the number here and the pricing page must move together.
 */
export const SUBSCRIPTION_QUOTA_BY_PLAN: Record<string, number | null> = {
	none: 3,
	launch: 25,
	scale: null,
	enterprise: null,
};

export async function resolveSubscriptionQuota(
	db: Kysely<Database>,
	accountId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): Promise<number | null> {
	if (!isPlatformMode()) return null;
	if (accountId && genesisExemptAccountIds(env).has(accountId)) return null;
	if (!accountId) return SUBSCRIPTION_QUOTA_BY_PLAN.none;
	const row = await db
		.selectFrom("accounts")
		.select("plan")
		.where("id", "=", accountId)
		.executeTakeFirst();
	const plan = row?.plan ?? "none";
	// `??` would turn an intentional null (unlimited) into the free quota.
	return plan in SUBSCRIPTION_QUOTA_BY_PLAN
		? SUBSCRIPTION_QUOTA_BY_PLAN[plan]
		: SUBSCRIPTION_QUOTA_BY_PLAN.none;
}

/**
 * Effective start block for a deploy under the policy.
 *
 * - genesis allowed → requested (or undefined: caller's existing semantics).
 * - clamped, new deploy → max(requested ?? tip, tip): forward-only.
 * - clamped, redeploy → max(requested ?? existing, existing): preserves the
 *   registered start (no spurious force-reindex, no upsert wipe-to-0) while
 *   still refusing to move history *backward*. Moving forward is allowed —
 *   it only reduces work. Legacy rows with start 0 are grandfathered.
 */
export function clampDeployStartBlock(input: {
	genesisAllowed: boolean;
	requested: number | undefined;
	existingStartBlock: number | undefined;
	chainTip: number;
}): { startBlock: number | undefined; clamped: boolean } {
	const { genesisAllowed, requested, existingStartBlock, chainTip } = input;
	if (genesisAllowed) return { startBlock: requested, clamped: false };
	const floor =
		existingStartBlock !== undefined ? existingStartBlock : Math.max(chainTip, 1);
	const effective = Math.max(requested ?? floor, floor);
	const wouldHaveUsed = requested ?? existingStartBlock ?? 1;
	return { startBlock: effective, clamped: effective !== wouldHaveUsed };
}
