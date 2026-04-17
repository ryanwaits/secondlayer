import { anthropic } from "@ai-sdk/anthropic";
import { logger } from "@secondlayer/shared/logger";
import type { AIStepOptions, SchemaField } from "@secondlayer/workflows";
import {
	type LanguageModel,
	generateObject,
	generateText,
	stepCountIs,
} from "ai";
import { type ZodType, type ZodTypeAny, z } from "zod/v4";

// ---------- Model resolution ----------

const ANTHROPIC_ALIAS: Record<string, string> = {
	haiku: "claude-haiku-4-5-20251001",
	sonnet: "claude-sonnet-4-6",
};

/**
 * Resolve a workflow-facing `model` value to an AI SDK `LanguageModel`.
 *
 * Accepts:
 *   - Legacy alias string (`"haiku"`, `"sonnet"`) → Anthropic model
 *   - Raw Anthropic model id string (`"claude-…"`) → Anthropic model
 *   - Pre-built `LanguageModel` object (any provider) → pass-through
 */
export function resolveModel(
	model: string | LanguageModel | undefined,
): LanguageModel {
	if (model == null) return anthropic(ANTHROPIC_ALIAS.haiku);
	if (typeof model === "string") {
		return anthropic(ANTHROPIC_ALIAS[model] ?? model);
	}
	return model;
}

// ---------- Usage normalization ----------

export interface LanguageModelUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

function coerceUsage(usage: unknown): LanguageModelUsage {
	const u = usage as
		| { inputTokens?: number; outputTokens?: number; totalTokens?: number }
		| undefined;
	const inputTokens = u?.inputTokens ?? 0;
	const outputTokens = u?.outputTokens ?? 0;
	return {
		inputTokens,
		outputTokens,
		totalTokens: u?.totalTokens ?? inputTokens + outputTokens,
	};
}

// ---------- generateObject (new v2 primitive) ----------

export interface GenerateObjectStepOptions {
	model?: string | LanguageModel;
	schema: ZodTypeAny;
	prompt: string;
	system?: string;
}

export interface GenerateObjectStepResult {
	object: unknown;
	usage: LanguageModelUsage;
}

export async function executeGenerateObject(
	options: GenerateObjectStepOptions,
): Promise<GenerateObjectStepResult> {
	const result = await generateObject({
		model: resolveModel(options.model),
		schema: options.schema,
		prompt: options.prompt,
		system: options.system,
	});
	return { object: result.object, usage: coerceUsage(result.usage) };
}

// ---------- generateText (new v2 primitive) ----------

export interface GenerateTextStepOptions {
	model?: string | LanguageModel;
	prompt: string;
	system?: string;
	// `Tool` brand type doesn't cross duplicated `@ai-sdk/provider-utils`
	// copies in the monorepo, so we accept opaque tool records here and let
	// AI SDK validate shape at runtime.
	tools?: Record<string, unknown>;
	maxSteps?: number;
}

export interface GenerateTextStepResult {
	text: string;
	toolCalls: unknown[];
	steps: unknown[];
	usage: LanguageModelUsage;
}

export async function executeGenerateText(
	options: GenerateTextStepOptions,
): Promise<GenerateTextStepResult> {
	const result = await generateText({
		model: resolveModel(options.model),
		prompt: options.prompt,
		system: options.system,
		tools: options.tools,
		stopWhen: options.maxSteps ? stepCountIs(options.maxSteps) : undefined,
	} as unknown as Parameters<typeof generateText>[0]);
	return {
		text: result.text,
		toolCalls: result.toolCalls as unknown[],
		steps: result.steps as unknown[],
		usage: coerceUsage(result.usage),
	};
}

// ---------- v1 step.ai shim (deprecated; sunset in 90 days) ----------

function buildZodFromSchemaFields(
	fields: Record<string, SchemaField>,
): ZodType<Record<string, unknown>> {
	const shape: Record<string, ZodTypeAny> = {};
	for (const [key, field] of Object.entries(fields)) {
		let zt: ZodTypeAny;
		switch (field.type) {
			case "string":
				zt = z.string();
				break;
			case "number":
				zt = z.number();
				break;
			case "boolean":
				zt = z.boolean();
				break;
			case "array":
				zt = z.array(
					field.items === "string"
						? z.string()
						: field.items === "number"
							? z.number()
							: field.items === "boolean"
								? z.boolean()
								: z.unknown(),
				);
				break;
			case "object":
				zt = z.object({}).catchall(z.unknown());
				break;
			default:
				zt = z.unknown();
		}
		if (field.description) zt = zt.describe(field.description);
		shape[key] = zt;
	}
	return z.object(shape) as ZodType<Record<string, unknown>>;
}

export interface AiStepResult {
	output: Record<string, unknown>;
	tokensUsed: number;
}

let deprecationLogged = false;

/**
 * Legacy v1 `step.ai` path — now a shim over generateObject/generateText.
 * Scheduled for removal 90 days after v2 release. Authors should migrate to
 * `step.generateObject` with a Zod schema.
 */
export async function executeAiStep(
	options: AIStepOptions,
): Promise<AiStepResult> {
	if (!deprecationLogged) {
		logger.warn(
			"step.ai is deprecated; migrate to step.generateObject(id, { model, schema: z.object({…}), prompt }). Sunset in 90 days.",
		);
		deprecationLogged = true;
	}

	if (options.schema) {
		const schema = buildZodFromSchemaFields(options.schema);
		const result = await executeGenerateObject({
			model: options.model,
			schema,
			prompt: options.prompt,
		});
		return {
			output: result.object as Record<string, unknown>,
			tokensUsed: result.usage.totalTokens,
		};
	}

	const result = await executeGenerateText({
		model: options.model,
		prompt: options.prompt,
	});
	return {
		output: { text: result.text },
		tokensUsed: result.usage.totalTokens,
	};
}
