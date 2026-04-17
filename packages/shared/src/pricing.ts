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
