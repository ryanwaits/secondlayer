import { logger } from "../logger.ts";
import { type RawAnswer, normalizeAnswer } from "./confidence.ts";
import { MAX_STATE_CHARS, stateSize, validateQuestions } from "./limits.ts";
import { DEFAULT_MODEL, buildModel, resolveProvider } from "./providers.ts";
import { runRules } from "./rules.ts";
import type {
	Answers,
	ClassifierName,
	ClassifyResult,
	Question,
	RulesFn,
} from "./types.ts";

/**
 * One classifier call over jev, kev, clef or offline rules.
 * Returns null on any provider failure (fail-open: callers decide what null
 * means). Only ClassifierInputError, a bad question definition, escapes.
 * Never logs state or response bodies.
 */
export async function classify<
	const Q extends Record<string, Question>,
>(input: {
	state: string | Record<string, unknown>;
	questions: Q;
	rules?: RulesFn<Q>;
	/** Overrides resolveProvider(); used by classifier-compare. */
	provider?: ClassifierName;
	/** Overrides CLASSIFIER_MODEL / the provider default. */
	modelId?: string;
	/** Default 5000. */
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
	/** Tests only (kev/clef). */
	fetchImpl?: typeof fetch;
}): Promise<ClassifyResult<Q> | null> {
	validateQuestions(input.questions);
	const env = input.env ?? process.env;
	const resolved = resolveProvider(env);
	const name = input.provider ?? resolved.name;
	if (name === "rules") {
		if (!input.rules) return null;
		return {
			provider: "rules",
			modelId: "rules",
			answers: runRules(input.questions, input.rules, input.state),
		};
	}
	// An explicit provider override ignores CLASSIFIER_MODEL (it pins one backend).
	const modelId =
		input.modelId ??
		(input.provider ? undefined : env.CLASSIFIER_MODEL) ??
		DEFAULT_MODEL[name];

	if (stateSize(input.state) > MAX_STATE_CHARS) {
		logger.warn(`classifier: state over ${MAX_STATE_CHARS} chars; skipped`);
		return null;
	}
	try {
		const { experimental_decide: decide } = await import("ai");
		const r = await decide({
			model: buildModel(name, modelId, env, input.fetchImpl),
			state: input.state as string,
			// Our Question is a structural subset of the SDK's question type.
			questions: input.questions as Parameters<typeof decide>[0]["questions"],
			maxRetries: 1,
			abortSignal: AbortSignal.timeout(input.timeoutMs ?? 5000),
		});
		const answers: Record<string, ReturnType<typeof normalizeAnswer>> = {};
		for (const id of Object.keys(input.questions)) {
			answers[id] = normalizeAnswer(
				input.questions[id] as Question,
				(r.answers as Record<string, RawAnswer>)[id] ?? { type: "refusal" },
			);
		}
		return {
			provider: name,
			modelId: r.response.modelId ?? modelId,
			answers: answers as Answers<Q>,
		};
	} catch (err) {
		logger.warn(
			`classifier: ${name} failed: ${err instanceof Error ? err.name : "error"}`,
		);
		return null;
	}
}
