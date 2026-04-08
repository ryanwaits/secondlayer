import Anthropic from "@anthropic-ai/sdk";
import type { AIStepOptions } from "@secondlayer/workflows";

const MODEL_MAP: Record<string, string> = {
	haiku: "claude-haiku-4-5-20251001",
	sonnet: "claude-sonnet-4-6",
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!client) {
		client = new Anthropic();
	}
	return client;
}

export interface AiStepResult {
	output: Record<string, unknown>;
	tokensUsed: number;
}

/**
 * Execute an AI analysis step using the Anthropic API.
 * If `schema` is provided, uses tool_use to enforce structured output.
 */
export async function executeAiStep(
	options: AIStepOptions,
): Promise<AiStepResult> {
	const model = MODEL_MAP[options.model ?? "haiku"] ?? MODEL_MAP.haiku;
	const anthropic = getClient();

	if (options.schema) {
		// Use tool_use for structured output
		const properties: Record<string, { type: string; description?: string }> =
			{};
		for (const [key, field] of Object.entries(options.schema)) {
			properties[key] = {
				type: field.type,
				...(field.description ? { description: field.description } : {}),
			};
		}

		const response = await anthropic.messages.create({
			model,
			max_tokens: 1024,
			messages: [{ role: "user", content: options.prompt }],
			tools: [
				{
					name: "structured_output",
					description: "Return the analysis result as structured data",
					input_schema: {
						type: "object" as const,
						properties,
						required: Object.keys(properties),
					},
				},
			],
			tool_choice: { type: "tool", name: "structured_output" },
		});

		const tokensUsed =
			(response.usage?.input_tokens ?? 0) +
			(response.usage?.output_tokens ?? 0);

		const toolBlock = response.content.find((b) => b.type === "tool_use");
		const output =
			toolBlock?.type === "tool_use"
				? (toolBlock.input as Record<string, unknown>)
				: {};

		return { output, tokensUsed };
	}

	// Unstructured text response
	const response = await anthropic.messages.create({
		model,
		max_tokens: 1024,
		messages: [{ role: "user", content: options.prompt }],
	});

	const tokensUsed =
		(response.usage?.input_tokens ?? 0) +
		(response.usage?.output_tokens ?? 0);

	const textBlock = response.content.find((b) => b.type === "text");
	const text = textBlock?.type === "text" ? textBlock.text : "";

	return { output: { text }, tokensUsed };
}
