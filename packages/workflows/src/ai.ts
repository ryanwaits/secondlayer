/**
 * Wrapped AI SDK providers — optional convenience for workflow authors.
 *
 * The runtime has no wrapper around `generateObject` / `generateText` — you
 * call them directly inside `step.run`. But if you want automatic usage
 * recording + (future) per-tenant cap enforcement, import the model from
 * here instead of from `@ai-sdk/anthropic` directly.
 *
 * ```ts
 * import { anthropic } from "@secondlayer/workflows/ai"
 * const result = await generateObject({ model: anthropic("claude-haiku-4-5-20251001"), ... })
 * ```
 *
 * v1: middleware is a no-op. When the runtime's AsyncLocalStorage carries
 * a `{ runId, tenantId, stepId }` context, the middleware will read it and
 * persist `prompt_tokens`, `completion_tokens`, `model_id` to the current
 * step row. Cap enforcement comes next — pre-call check against
 * `workflow_ai_usage_daily`, throw `AiCapReachedError` on exceed.
 */

import { anthropic as anthropicBase } from "@ai-sdk/anthropic";
import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";

const recordingMiddleware: LanguageModelMiddleware = {
	specificationVersion: "v3",
	async wrapGenerate({ doGenerate }) {
		const result = await doGenerate();
		// Hook point — runtime will read ALS context + persist usage here.
		return result;
	},
	async wrapStream({ doStream }) {
		return await doStream();
	},
};

type AnthropicModelId = Parameters<typeof anthropicBase>[0];

export function anthropic(modelId: AnthropicModelId): LanguageModel {
	return wrapLanguageModel({
		model: anthropicBase(modelId),
		middleware: recordingMiddleware,
	});
}
