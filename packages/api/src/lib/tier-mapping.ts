/**
 * Tier ↔ Stripe price ID mapping.
 *
 * Forward: plan tier → Stripe price id (via env var). Used when creating
 * Checkout sessions.
 *
 * Reverse: Stripe price id → plan tier. Used by the webhook to resolve a
 * subscription event back to a tier name so we can write `accounts.plan`.
 *
 * Single source of truth is the env. Prices that aren't configured in
 * env (missing or typo) fall through to undefined — callers log + skip.
 */

export type UpgradeableTier = "launch" | "scale";

export const TIER_PRICE_ENV: Record<UpgradeableTier, string> = {
	launch: "STRIPE_PRICE_LAUNCH",
	scale: "STRIPE_PRICE_SCALE",
};

export const UPGRADEABLE_TIERS: readonly UpgradeableTier[] = [
	"launch",
	"scale",
];

export function isUpgradeableTier(s: string): s is UpgradeableTier {
	return (UPGRADEABLE_TIERS as readonly string[]).includes(s);
}

/** Resolve a plan tier to its Stripe price id, or undefined if env unset. */
export function getPriceIdForTier(tier: UpgradeableTier): string | undefined {
	const envVar = TIER_PRICE_ENV[tier];
	const value = process.env[envVar];
	return value && value.length > 0 ? value : undefined;
}

/**
 * Reverse map: Stripe price id → plan tier. Built lazily per process.
 * Rebuilds when env changes (rare in production — process restart —
 * but covered for dev / CI).
 */
let reverseCache: {
	snapshot: string;
	map: Map<string, UpgradeableTier>;
} | null = null;

function buildReverseMap(): Map<string, UpgradeableTier> {
	const snapshot = UPGRADEABLE_TIERS.map(
		(t) => process.env[TIER_PRICE_ENV[t]],
	).join("|");
	if (reverseCache && reverseCache.snapshot === snapshot) {
		return reverseCache.map;
	}
	const map = new Map<string, UpgradeableTier>();
	for (const tier of UPGRADEABLE_TIERS) {
		const priceId = getPriceIdForTier(tier);
		if (priceId) map.set(priceId, tier);
	}
	reverseCache = { snapshot, map };
	return map;
}

/** Resolve a Stripe price id to the tier name, or undefined if unknown. */
export function getTierForPriceId(
	priceId: string,
): UpgradeableTier | undefined {
	return buildReverseMap().get(priceId);
}
