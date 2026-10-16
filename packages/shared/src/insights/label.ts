import { classify } from "../classify/index.ts";
import type { Question } from "../classify/index.ts";
import { logger } from "../logger.ts";
import type { DetectedInsight } from "./types.ts";

/**
 * Optional cause label. Code finds every insight and writes every sentence;
 * the model may only pick one cause from a fixed list, and the label shows
 * only at confidence 0.85 or higher. Off unless INSIGHTS_MODEL_LABELS=on, and
 * turning it on is gated on the insights-layer spike (plan 054).
 */

export const CAUSE_CONFIDENCE = 0.85;
const LABEL_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 6 * 3600_000;

export const CAUSE_QUESTIONS = {
	cause: {
		type: "choice",
		instructions: "Which cause best explains this webhook's change?",
		criteria: {
			receiver_down:
				"receiver unreachable: 5xx from a proxy, connection refused, timeouts",
			receiver_rate_limiting: "receiver answers 429 or slows under load",
			receiver_rejects_payload: "4xx other than 429: auth, schema, signature",
			receiver_slow: "2xx but response time well above baseline",
			tls_or_dns: "certificate or name resolution errors",
			chain_quiet: "matching events dropped as much as deliveries",
			config_change: "change began right after the webhook's settings changed",
			our_side: "delivery service or chain source is behind (cursor lag)",
			unknown: "none of these fit the evidence",
		},
	},
} as const satisfies Record<string, Question>;

type LabelOutcome = { cause: string; confidence: number } | null;
type LabelCache = Map<string, { at: number; outcome: LabelOutcome }>;

const defaultCache: LabelCache = new Map();

export function resetLabelCache(): void {
	defaultCache.clear();
}

export interface LabelDeps {
	classifyFn?: typeof classify;
	env?: Record<string, string | undefined>;
	now?: number;
	cache?: LabelCache;
}

function cacheKey(insight: DetectedInsight): string {
	const codes = insight.evidence
		.flatMap((e) => (e.kind === "shapes" ? e.shapes.map((s) => s.code) : []))
		.sort()
		.join(",");
	return `${insight.resource.kind}:${insight.resource.id}:${insight.rule}:${codes}`;
}

function renderState(insight: DetectedInsight): string {
	return [
		`${insight.resource.kind} ${insight.resource.name}`,
		`rule: ${insight.rule}`,
		`detector: ${insight.how.detector}`,
		...insight.how.facts.map(([k, v]) => `${k}: ${v}`),
	].join("\n");
}

export async function maybeLabel(
	insight: DetectedInsight,
	deps: LabelDeps = {},
): Promise<DetectedInsight> {
	const env = deps.env ?? process.env;
	if (env.INSIGHTS_MODEL_LABELS !== "on") return insight;
	if (!insight.rule.startsWith("receiver_")) return insight;

	const now = deps.now ?? Date.now();
	const cache = deps.cache ?? defaultCache;
	const key = cacheKey(insight);
	const hit = cache.get(key);
	let outcome: LabelOutcome;

	if (hit && now - hit.at < CACHE_TTL_MS) {
		outcome = hit.outcome;
	} else {
		const result = await (deps.classifyFn ?? classify)({
			state: renderState(insight),
			questions: CAUSE_QUESTIONS,
			timeoutMs: LABEL_TIMEOUT_MS,
			env,
		}).catch((err: unknown) => {
			logger.warn("insights.label_failed", { error: String(err) });
			return null;
		});
		// Provider down: leave the insight alone and try again next pass.
		if (!result) return insight;
		const answer = result.answers.cause;
		outcome =
			answer.type === "choice" &&
			answer.confidence >= CAUSE_CONFIDENCE &&
			answer.choice !== "unknown"
				? { cause: answer.choice, confidence: answer.confidence }
				: null;
		cache.set(key, { at: now, outcome });
	}

	if (!outcome) return insight;
	return { ...insight, how: { ...insight.how, label: outcome } };
}
