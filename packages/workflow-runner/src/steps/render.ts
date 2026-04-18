import type { Catalog } from "@json-render/core";
import type { LanguageModel } from "ai";
import { executeGenerateObject } from "./ai.ts";

export interface RenderStepOptions {
	model?: string | LanguageModel;
	prompt: string;
	system?: string;
	/**
	 * Arbitrary context (event, prior step outputs) interpolated into the
	 * user prompt so the AI has the data it needs to produce a catalog-
	 * conforming spec.
	 */
	context?: Record<string, unknown>;
}

export interface RenderStepResult {
	spec: unknown;
	usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/**
 * Execute a `step.render` invocation: derive a Zod schema from the catalog,
 * call the AI with a catalog-aware system prompt, validate the returned
 * spec, and hand back the validated JSON for downstream delivery / dashboard
 * rendering.
 */
export async function executeRenderStep(
	catalog: Catalog,
	options: RenderStepOptions,
): Promise<RenderStepResult> {
	const zodSchema = catalog.zodSchema();

	const catalogPrompt = catalog.prompt();
	const system = options.system
		? `${options.system}\n\n${catalogPrompt}`
		: catalogPrompt;

	const contextBlock = options.context
		? `\n\n---\nContext:\n${JSON.stringify(options.context, null, 2)}`
		: "";
	const prompt = `${options.prompt}${contextBlock}`;

	const aiResult = await executeGenerateObject({
		model: options.model,
		schema: zodSchema as never,
		prompt,
		system,
	});

	const validated = catalog.validate(aiResult.object);
	if (!validated.success || validated.data == null) {
		const issueText = validated.error?.issues
			?.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("; ");
		throw new Error(
			`step.render: catalog validation failed — ${issueText ?? "unknown"}`,
		);
	}

	return {
		spec: validated.data,
		usage: aiResult.usage,
	};
}
