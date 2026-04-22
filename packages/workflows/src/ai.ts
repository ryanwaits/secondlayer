/**
 * Wrapped AI SDK providers — optional convenience for workflow authors.
 *
 * Import the model from here (instead of `@ai-sdk/anthropic` directly)
 * to get automatic per-run usage recording. The recording sink is
 * injected by the runtime via `setAiUsageRecorder` — the SDK itself has
 * no DB dependency, so publishing this package doesn't drag in
 * `@secondlayer/shared`.
 *
 *   // in workflow code
 *   import { anthropic } from "@secondlayer/workflows/ai"
 *   await generateObject({ model: anthropic("claude-haiku-4-5-20251001"), ... })
 *
 *   // in the runtime boot
 *   import { setAiUsageRecorder } from "@secondlayer/workflows/ai"
 *   setAiUsageRecorder(async ({ accountId, tenantId, provider, modelId, usage }) => {
 *     await bumpAiUsage(db, { accountId, tenantId, provider, modelId, usage });
 *   })
 *
 * Per-call attribution comes from `workflowAls` (see ./als.ts). If no
 * ALS context is present (dev scripts, tests), the middleware skips the
 * record entirely — it never blocks generate and never throws.
 */

import { anthropic as anthropicBase } from "@ai-sdk/anthropic";
import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";
import { getCurrentContext } from "./als.ts";

export interface AiUsageRecord {
	runId: string;
	accountId: string;
	tenantId: string | null;
	provider: string;
	modelId: string;
	usage: { inputTokens: number; outputTokens: number };
}

export type AiUsageRecorder = (record: AiUsageRecord) => Promise<void> | void;

let recorder: AiUsageRecorder | null = null;

/**
 * Register a sink for AI usage records. Called once by the workflow
 * runtime on boot. Calling it twice replaces the previous recorder
 * (tests + hot reload).
 */
export function setAiUsageRecorder(fn: AiUsageRecorder | null): void {
	recorder = fn;
}

function extractTokens(usage: unknown): {
	inputTokens: number;
	outputTokens: number;
} {
	if (usage == null || typeof usage !== "object") {
		return { inputTokens: 0, outputTokens: 0 };
	}
	const u = usage as Record<string, unknown>;
	const input = Number(u.inputTokens ?? u.promptTokens ?? 0);
	const output = Number(u.outputTokens ?? u.completionTokens ?? 0);
	return {
		inputTokens: Number.isFinite(input) ? input : 0,
		outputTokens: Number.isFinite(output) ? output : 0,
	};
}

function makeMiddleware(
	provider: string,
	modelId: string,
): LanguageModelMiddleware {
	return {
		specificationVersion: "v3",
		async wrapGenerate({ doGenerate }) {
			const result = await doGenerate();
			const ctx = getCurrentContext();
			if (recorder && ctx?.accountId) {
				try {
					await recorder({
						runId: ctx.runId,
						accountId: ctx.accountId,
						tenantId: ctx.tenantId,
						provider,
						modelId,
						usage: extractTokens(result.usage),
					});
				} catch {
					// Never fail the generate on recorder errors.
				}
			}
			return result;
		},
		async wrapStream({ doStream }) {
			return await doStream();
		},
	};
}

type AnthropicModelId = Parameters<typeof anthropicBase>[0];

export function anthropic(modelId: AnthropicModelId): LanguageModel {
	return wrapLanguageModel({
		model: anthropicBase(modelId),
		middleware: makeMiddleware("anthropic", String(modelId)),
	});
}
