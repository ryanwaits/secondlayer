export type ClassifierName = "jev" | "kev" | "clef" | "rules";

export type Question =
	| { type: "choice"; instructions: string; criteria: Record<string, string> }
	| { type: "score"; instructions: string; criteria: readonly string[] }
	| {
			type: "boolean";
			instructions: string;
			criteria: { true: string; false: string };
	  };

export type Answer =
	| {
			type: "choice";
			choice: string;
			probabilities: Record<string, number>;
			confidence: number;
	  }
	| {
			type: "score";
			score: number;
			probabilities: Record<string, number>;
			confidence: number;
	  }
	| { type: "boolean"; probability: number; confidence: number }
	| { type: "refusal" };

export type Answers<Q extends Record<string, Question>> = {
	[K in keyof Q]: Answer;
};

export type ClassifyResult<Q extends Record<string, Question>> = {
	provider: ClassifierName;
	/** response.modelId when the backend reports one. */
	modelId: string;
	answers: Answers<Q>;
};

/** Deterministic answers for the offline provider. Return a value per question
 *  it can decide; omitted questions come back as `{ type: "refusal" }`. */
export type RuleValue =
	| string /* choice option */
	| number /* score level index */
	| boolean;
export type RulesFn<Q extends Record<string, Question>> = (
	state: string | Record<string, unknown>,
) => { [K in keyof Q]?: RuleValue } | null;

export class ClassifierInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClassifierInputError";
	}
}
