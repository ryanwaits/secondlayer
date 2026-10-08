import type { Answer, Answers, Question, RuleValue, RulesFn } from "./types.ts";

function answerFor(question: Question, value: RuleValue | undefined): Answer {
	if (value === undefined) return { type: "refusal" };
	if (question.type === "choice") {
		if (typeof value !== "string" || !(value in question.criteria)) {
			return { type: "refusal" };
		}
		const probabilities = Object.fromEntries(
			Object.keys(question.criteria).map((k) => [k, k === value ? 1 : 0]),
		);
		return { type: "choice", choice: value, probabilities, confidence: 1 };
	}
	if (question.type === "score") {
		const n = question.criteria.length;
		if (typeof value !== "number" || !Number.isInteger(value)) {
			return { type: "refusal" };
		}
		if (value < 0 || value >= n) return { type: "refusal" };
		const probabilities = Object.fromEntries(
			Array.from({ length: n }, (_, i) => [String(i), i === value ? 1 : 0]),
		);
		return { type: "score", score: value, probabilities, confidence: 1 };
	}
	if (typeof value !== "boolean") return { type: "refusal" };
	return { type: "boolean", probability: value ? 1 : 0, confidence: 1 };
}

/** Offline provider: deterministic, never touches the network. */
export function runRules<Q extends Record<string, Question>>(
	questions: Q,
	fn: RulesFn<Q>,
	state: string | Record<string, unknown>,
): Answers<Q> {
	const values = fn(state) ?? {};
	const out: Record<string, Answer> = {};
	for (const id of Object.keys(questions)) {
		out[id] = answerFor(
			questions[id] as Question,
			(values as Record<string, RuleValue | undefined>)[id],
		);
	}
	return out as Answers<Q>;
}
