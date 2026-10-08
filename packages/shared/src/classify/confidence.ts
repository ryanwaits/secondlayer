import type { Answer, Question } from "./types.ts";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** (p_max - 1/K) / (1 - 1/K). One option gives 1. */
export function choiceConfidence(
	probabilities: Record<string, number>,
): number {
	const ps = Object.values(probabilities);
	const k = ps.length;
	if (k <= 1) return 1;
	const pmax = Math.max(...ps);
	return clamp01((pmax - 1 / k) / (1 - 1 / k));
}

/** max(0, 1 - E|level - mode| / D); D = mean distance of a uniform
 *  distribution over the levels from the middle level. */
export function scoreConfidence(
	probabilities: Record<string, number>,
	levels: number,
): number {
	if (levels <= 1) return 1;
	let mode = 0;
	let best = -1;
	for (let i = 0; i < levels; i++) {
		const p = probabilities[String(i)] ?? 0;
		if (p > best) {
			best = p;
			mode = i;
		}
	}
	let e = 0;
	let d = 0;
	for (let i = 0; i < levels; i++) {
		e += (probabilities[String(i)] ?? 0) * Math.abs(i - mode);
		d += Math.abs(i - (levels - 1) / 2);
	}
	d /= levels;
	return clamp01(1 - e / d);
}

/** Host-defined: |2p - 1|. Not comparable with choice/score confidence. */
export function booleanConfidence(p: number): number {
	return Math.abs(2 * p - 1);
}

/** Shape of an `ai` DecisionAnswer, or the rules output, before normalizing. */
export type RawAnswer =
	| { type: "choice"; choice: string; probabilities?: Record<string, number> }
	| { type: "score"; score: number; probabilities?: Record<string, number> }
	| { type: "boolean"; probability: number }
	| { type: "refusal" };

export function normalizeAnswer(question: Question, raw: RawAnswer): Answer {
	if (raw.type === "refusal") return { type: "refusal" };
	if (raw.type === "boolean" && question.type === "boolean") {
		return {
			type: "boolean",
			probability: raw.probability,
			confidence: booleanConfidence(raw.probability),
		};
	}
	if (raw.type === "choice" && question.type === "choice") {
		const probabilities = raw.probabilities ?? {};
		// Never fabricate a distribution: no probabilities means confidence 0.
		return {
			type: "choice",
			choice: raw.choice,
			probabilities,
			confidence: raw.probabilities ? choiceConfidence(probabilities) : 0,
		};
	}
	if (raw.type === "score" && question.type === "score") {
		const probabilities = raw.probabilities ?? {};
		return {
			type: "score",
			score: raw.score,
			probabilities,
			confidence: raw.probabilities
				? scoreConfidence(probabilities, question.criteria.length)
				: 0,
		};
	}
	return { type: "refusal" };
}
