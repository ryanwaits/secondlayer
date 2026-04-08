import { z } from "zod/v4";
import { SubgraphFilterSchema } from "@secondlayer/subgraphs/validate";
import type {
	EventTrigger,
	ManualInputField,
	ManualTrigger,
	RetryConfig,
	ScheduleTrigger,
	StreamTrigger,
	WorkflowDefinition,
	WorkflowTrigger,
	McpStepOptions,
	DiscordTarget,
	TelegramTarget,
} from "./types.ts";

export const WorkflowNameSchema: z.ZodType<string> = z
	.string()
	.min(1)
	.max(63)
	.regex(
		/^[a-z][a-z0-9-]*$/,
		"Must start with lowercase letter, contain only lowercase alphanumeric and hyphens",
	);

export const EventTriggerSchema: z.ZodType<EventTrigger> = z.object({
	type: z.literal("event"),
	filter: SubgraphFilterSchema,
}) as z.ZodType<EventTrigger>;

export const StreamTriggerSchema: z.ZodType<StreamTrigger> = z.object({
	type: z.literal("stream"),
	filter: SubgraphFilterSchema,
}) as z.ZodType<StreamTrigger>;

export const ScheduleTriggerSchema: z.ZodType<ScheduleTrigger> = z.object({
	type: z.literal("schedule"),
	cron: z.string().min(1),
	timezone: z.string().optional(),
}) as z.ZodType<ScheduleTrigger>;

export const ManualInputFieldSchema: z.ZodType<ManualInputField> = z.object({
	type: z.enum(["string", "number", "boolean"]),
	required: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
	description: z.string().optional(),
}) as z.ZodType<ManualInputField>;

export const ManualTriggerSchema: z.ZodType<ManualTrigger> = z.object({
	type: z.literal("manual"),
	input: z.record(z.string(), ManualInputFieldSchema).optional(),
}) as z.ZodType<ManualTrigger>;

export const WorkflowTriggerSchema: z.ZodType<WorkflowTrigger> = z.union([
	EventTriggerSchema,
	StreamTriggerSchema,
	ScheduleTriggerSchema,
	ManualTriggerSchema,
]) as z.ZodType<WorkflowTrigger>;

export const RetryConfigSchema: z.ZodType<RetryConfig> = z.object({
	maxAttempts: z.number().int().positive().optional(),
	backoffMs: z.number().int().nonnegative().optional(),
	backoffMultiplier: z.number().positive().optional(),
}) as z.ZodType<RetryConfig>;

export const McpStepOptionsSchema: z.ZodType<McpStepOptions> = z.object({
	server: z.string().min(1),
	tool: z.string().min(1),
	args: z.record(z.string(), z.unknown()).optional(),
});

export const DiscordTargetSchema: z.ZodType<DiscordTarget> = z.object({
	type: z.literal("discord"),
	webhookUrl: z.string().url(),
	content: z.string().min(1),
	username: z.string().optional(),
	avatarUrl: z.string().optional(),
});

export const TelegramTargetSchema: z.ZodType<TelegramTarget> = z.object({
	type: z.literal("telegram"),
	botToken: z.string().min(1),
	chatId: z.string().min(1),
	text: z.string().min(1),
	parseMode: z.enum(["HTML", "Markdown"]).optional(),
});

export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> =
	z.object({
		name: WorkflowNameSchema,
		trigger: WorkflowTriggerSchema,
		handler: z.function(),
		retries: RetryConfigSchema.optional(),
		timeout: z.number().int().positive().optional(),
	}) as unknown as z.ZodType<WorkflowDefinition>;

/**
 * Validates a workflow definition, returning the parsed result or throwing on failure.
 */
export function validateWorkflowDefinition(def: unknown): WorkflowDefinition {
	return WorkflowDefinitionSchema.parse(def) as WorkflowDefinition;
}
