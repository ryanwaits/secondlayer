/**
 * Token → USD pricing constants for internal observability.
 *
 * **Not customer billing.** Tier pricing covers compute; these constants
 * let the dashboard display "~$X spent in AI today" and let us track
 * gross-margin internally. Update manually when providers change prices
 * (roughly twice per year).
 *
 * Source: public provider pricing pages as of 2026-04-17.
 */

export interface ModelPricing {
	/** USD per 1M input tokens */
	inputPerMTokens: number;
	/** USD per 1M output tokens */
	outputPerMTokens: number;
}

export const MODEL_PRICING: Record<string, Record<string, ModelPricing>> = {
	anthropic: {
		"claude-haiku-4-5": { inputPerMTokens: 1, outputPerMTokens: 5 },
		"claude-haiku-4-5-20251001": { inputPerMTokens: 1, outputPerMTokens: 5 },
		"claude-sonnet-4-6": { inputPerMTokens: 3, outputPerMTokens: 15 },
		"claude-opus-4-7": { inputPerMTokens: 15, outputPerMTokens: 75 },
	},
	openai: {
		"gpt-4.1": { inputPerMTokens: 2.5, outputPerMTokens: 10 },
		"gpt-4o": { inputPerMTokens: 2.5, outputPerMTokens: 10 },
		"gpt-4o-mini": { inputPerMTokens: 0.15, outputPerMTokens: 0.6 },
	},
	google: {
		"gemini-2.5-pro": { inputPerMTokens: 1.25, outputPerMTokens: 10 },
		"gemini-2.5-flash": { inputPerMTokens: 0.3, outputPerMTokens: 2.5 },
	},
};

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
}

/**
 * Compute approximate USD cost for an AI step. Returns `null` if the
 * (provider, model) pair isn't in the pricing table — the caller should
 * display "-" rather than "$0".
 */
export function computeUsdCost(
	provider: string,
	modelId: string,
	usage: TokenUsage,
): number | null {
	const p = MODEL_PRICING[provider]?.[modelId];
	if (!p) return null;
	return (
		(usage.inputTokens * p.inputPerMTokens) / 1_000_000 +
		(usage.outputTokens * p.outputPerMTokens) / 1_000_000
	);
}

// ── Per-tier AI eval caps ─────────────────────────────────────────────
//
// Daily budget by tier. The caps table is surfaced on the dashboard's
// usage page; billing enforcement lives on the AI provider side (the
// product doesn't host AI inference itself post-pivot). Overage above
// cap bills to the `ai_evals` Stripe meter on paid tiers when we wire
// subscription-receiver-driven AI usage metering.
//
// Caps set conservatively so Pro Micro stays margin-positive at
// realistic utilization. Raise based on data, not aspiration.

export interface AiCap {
	/** Max step.ai / generateText / generateObject calls per UTC day. */
	evalsPerDay: number;
	/** Stripe meter events emitted for overage past this cap. */
	overageMeterEventName: "ai_evals";
}

const AI_CAP_UNLIMITED: AiCap = {
	evalsPerDay: Number.POSITIVE_INFINITY,
	overageMeterEventName: "ai_evals",
};

const AI_CAPS_BY_PLAN: Record<string, AiCap> = {
	hobby: { evalsPerDay: 50, overageMeterEventName: "ai_evals" },
	launch: { evalsPerDay: 500, overageMeterEventName: "ai_evals" },
	grow: { evalsPerDay: 1000, overageMeterEventName: "ai_evals" },
	scale: { evalsPerDay: 2500, overageMeterEventName: "ai_evals" },
	enterprise: AI_CAP_UNLIMITED,
};

/** Resolve the daily AI eval cap for a plan. Unknown plans get Hobby's
 *  cap so a stray DB value can't accidentally become unlimited. */
export function getAiCapForPlan(plan: string): AiCap {
	return AI_CAPS_BY_PLAN[plan] ?? AI_CAPS_BY_PLAN.hobby;
}

// ── Per-tier compute + storage allowances (usage page) ──────────────
//
// "Included" amounts per billing period. Actual billing comes from
// Stripe compute-hours + storage-overage meters; these constants power
// the dashboard display and the approximation used by `/api/accounts/usage`.
//
// Values picked to match `project_supabase_pricing_model.md`:
//   Hobby — 50 h / 5 GB  (Nano — free tier)
//   Launch — 500 h / 50 GB  ($149/mo)
//   Grow — 1,000 h / 200 GB  ($349/mo)
//   Scale — 2,500 h / 1 TB  ($799/mo)
//   Enterprise — ∞ / ∞

const BYTES_PER_GB = 1024 ** 3;

// Hobby has no compute-hour cap — auto-pause after 7d idle is the cap.
// Paid tiers bill Stripe-metered hours past the included credit; the
// hour equivalents below are approximate display values. Real billing
// uses the `compute_hours` meter in Stripe, not these numbers.
const COMPUTE_ALLOWANCE_BY_PLAN: Record<string, number> = {
	hobby: Number.POSITIVE_INFINITY,
	launch: 500,
	grow: 1000,
	scale: 2500,
	enterprise: Number.POSITIVE_INFINITY,
};

const STORAGE_ALLOWANCE_BYTES_BY_PLAN: Record<string, number> = {
	hobby: 5 * BYTES_PER_GB,
	launch: 50 * BYTES_PER_GB,
	grow: 200 * BYTES_PER_GB,
	scale: 1000 * BYTES_PER_GB,
	enterprise: Number.POSITIVE_INFINITY,
};

/** Included compute hours per billing period. Unknown → hobby. */
export function getComputeAllowanceHours(plan: string): number {
	return COMPUTE_ALLOWANCE_BY_PLAN[plan] ?? COMPUTE_ALLOWANCE_BY_PLAN.hobby;
}

/** Included storage bytes. Unknown → hobby. */
export function getStorageAllowanceBytes(plan: string): number {
	return (
		STORAGE_ALLOWANCE_BYTES_BY_PLAN[plan] ??
		STORAGE_ALLOWANCE_BYTES_BY_PLAN.hobby
	);
}

/** Whether this plan bills storage overage. Hobby has a hard cap
 *  (no overage billing); paid tiers bill $2/GB over allowance. */
export function hasStorageOverage(plan: string): boolean {
	return plan !== "hobby";
}

/** Base monthly price for a plan, in cents. Enterprise is custom → 0. */
const BASE_PRICE_CENTS_BY_PLAN: Record<string, number> = {
	hobby: 0,
	launch: 14900,
	grow: 34900,
	scale: 79900,
	enterprise: 0,
};

export function getBasePriceCents(plan: string): number {
	return BASE_PRICE_CENTS_BY_PLAN[plan] ?? 0;
}

/** Capitalized display name for a plan tier. */
export function getPlanDisplayName(plan: string): string {
	return plan.charAt(0).toUpperCase() + plan.slice(1);
}
