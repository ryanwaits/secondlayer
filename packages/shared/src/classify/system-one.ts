import type { Experimental_DecisionModel } from "ai"; // type-only: erased at runtime

type DecisionModelV4 = Extract<
	Experimental_DecisionModel,
	{ doDecide: unknown }
>;
type DoDecideOptions = Parameters<DecisionModelV4["doDecide"]>[0];
type DoDecideResult = Awaited<ReturnType<DecisionModelV4["doDecide"]>>;

type WireAnswer = {
	type: string;
	choice?: string;
	score?: number;
	noul?: number;
	probabilities?: Record<string, number>;
};

type WireBody = {
	model?: string;
	answers?: Record<string, WireAnswer>;
	usage?: { input_tokens?: number; output_tokens?: number };
};

function toWireState(state: DoDecideOptions["state"]): unknown {
	const parts = state.map((p) => {
		if (p.type === "text") return p.text;
		if (p.type === "json") return p.value;
		throw new Error("file state unsupported");
	});
	return parts.length === 1 ? parts[0] : parts;
}

/** Divide by the sum so the distribution sums to exactly 1. */
function renormalize(p: Record<string, number>): Record<string, number> {
	const sum = Object.values(p).reduce((a, b) => a + b, 0);
	if (!(sum > 0)) return p;
	return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v / sum]));
}

function mapAnswer(a: WireAnswer): DoDecideResult["answers"][string] {
	if (a.type === "noul" && typeof a.noul === "number") {
		return { type: "boolean", probability: a.noul };
	}
	if (a.type === "choice" && typeof a.choice === "string") {
		return {
			type: "choice",
			choice: a.choice,
			...(a.probabilities && { probabilities: renormalize(a.probabilities) }),
		};
	}
	if (a.type === "score" && typeof a.score === "number") {
		if (!a.probabilities) return { type: "score", score: a.score };
		const probabilities = renormalize(a.probabilities);
		// decide() checks score equals the weighted mean of the distribution.
		const score = Object.entries(probabilities).reduce(
			(s, [level, p]) => s + Number(level) * p,
			0,
		);
		return { type: "score", score, probabilities };
	}
	return { type: "refusal" };
}

/** Adapter for the System One wire protocol spoken by kev and clef. */
export function systemOneModel(opts: {
	provider: "kev" | "clef";
	url: string;
	/** Sent as body.model ("kev-latest", "clef", "clef-flash"). */
	modelId: string;
	apiKey?: string;
	fetchImpl?: typeof fetch;
}): DecisionModelV4 {
	const doFetch = opts.fetchImpl ?? fetch;
	return {
		specificationVersion: "v4",
		provider: `secondlayer.${opts.provider}`,
		modelId: opts.modelId,
		supportedQuestionTypes: ["choice", "score", "boolean"],
		async doDecide({ state, questions, abortSignal }) {
			const wireQuestions = Object.fromEntries(
				Object.entries(questions).map(([id, q]) => [
					id,
					q.type === "boolean" ? { ...q, type: "noul" } : q,
				]),
			);
			const res = await doFetch(opts.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(opts.apiKey && { authorization: `Bearer ${opts.apiKey}` }),
				},
				body: JSON.stringify({
					model: opts.modelId,
					state: toWireState(state),
					questions: wireQuestions,
				}),
				signal: abortSignal,
			});
			// Never include the body: it may echo state.
			if (!res.ok) throw new Error(`${opts.provider} ${res.status}`);
			const json = (await res.json()) as { result?: WireBody } & WireBody;
			const body = json.result ?? json;
			const answers = Object.fromEntries(
				Object.entries(body.answers ?? {}).map(([id, a]) => [id, mapAnswer(a)]),
			);
			return {
				answers,
				warnings: [],
				usage: {
					inputTokens: body.usage?.input_tokens,
					outputTokens: body.usage?.output_tokens,
				},
				response: { modelId: body.model ?? opts.modelId },
			} as DoDecideResult;
		},
	};
}
