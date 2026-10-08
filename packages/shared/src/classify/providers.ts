import type { Experimental_DecisionModel } from "ai"; // type-only: erased at runtime
import { logger } from "../logger.ts";
import { systemOneModel } from "./system-one.ts";
import type { ClassifierName } from "./types.ts";

type DecisionModelV4 = Extract<
	Experimental_DecisionModel,
	{ doDecide: unknown }
>;
type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL: Record<Exclude<ClassifierName, "rules">, string> = {
	jev: "typesafe-ai/jev",
	kev: "kev-latest",
	clef: "clef",
};

const REQUIRED_ENV: Record<Exclude<ClassifierName, "rules">, string[]> = {
	jev: ["AI_GATEWAY_API_KEY"],
	kev: ["KEV_URL"],
	clef: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
};

/** CLASSIFIER picks the backend; unset means jev when the gateway key is set,
 *  else offline rules. A backend missing credentials falls back to rules. */
export function resolveProvider(env: Env = process.env): {
	name: ClassifierName;
	modelId: string;
} {
	const rules = { name: "rules", modelId: "rules" } as const;
	const requested = env.CLASSIFIER?.trim();
	let name: ClassifierName;
	if (!requested) {
		name = env.AI_GATEWAY_API_KEY ? "jev" : "rules";
	} else if (
		requested === "jev" ||
		requested === "kev" ||
		requested === "clef" ||
		requested === "rules"
	) {
		name = requested;
	} else {
		logger.warn(`classifier: unknown CLASSIFIER=${requested}; using rules`);
		return rules;
	}
	if (name === "rules") return rules;
	const missing = REQUIRED_ENV[name].find((v) => !env[v]);
	if (missing) {
		logger.warn(
			`classifier: CLASSIFIER=${name} missing ${missing}; using rules`,
		);
		return rules;
	}
	return { name, modelId: env.CLASSIFIER_MODEL ?? DEFAULT_MODEL[name] };
}

export function buildModel(
	name: "jev" | "kev" | "clef",
	modelId: string,
	env: Env = process.env,
	fetchImpl?: typeof fetch,
): string | DecisionModelV4 {
	// The AI Gateway resolves a plain model id string.
	if (name === "jev") return modelId;
	if (name === "kev") {
		return systemOneModel({
			provider: "kev",
			url: `${(env.KEV_URL ?? "").replace(/\/$/, "")}/v1/systemone`,
			modelId,
			apiKey: env.KEV_API_KEY,
			fetchImpl,
		});
	}
	return systemOneModel({
		provider: "clef",
		url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/cloudflare/${modelId}`,
		modelId,
		apiKey: env.CLOUDFLARE_API_TOKEN,
		fetchImpl,
	});
}
