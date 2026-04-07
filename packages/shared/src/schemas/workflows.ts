import { z } from "zod/v4";

// ── Deploy Workflow Request ──────────────────────────────────────────

export interface DeployWorkflowRequest {
	name: string;
	trigger: Record<string, unknown>;
	handlerCode: string;
	retries?: { maxAttempts?: number; backoffMs?: number; backoffMultiplier?: number };
	timeout?: number;
}

export const DeployWorkflowRequestSchema: z.ZodType<DeployWorkflowRequest> =
	z.object({
		name: z
			.string()
			.regex(/^[a-z][a-z0-9-]*$/, "lowercase alphanumeric + hyphens, must start with letter")
			.max(63),
		trigger: z.record(z.string(), z.unknown()),
		handlerCode: z.string().max(1_048_576, "handler code exceeds 1MB limit"),
		retries: z
			.object({
				maxAttempts: z.number().int().positive().optional(),
				backoffMs: z.number().int().nonnegative().optional(),
				backoffMultiplier: z.number().positive().optional(),
			})
			.optional(),
		timeout: z.number().int().positive().optional(),
	});

export interface DeployWorkflowResponse {
	action: "created" | "updated";
	workflowId: string;
	message: string;
}

// ── API Response Types ───────────────────────────────────────────────

export interface WorkflowSummaryResponse {
	name: string;
	version: string;
	status: string;
	triggerType: string;
	totalRuns: number;
	lastRunAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WorkflowDetailResponse extends WorkflowSummaryResponse {
	triggerConfig: Record<string, unknown>;
	retriesConfig: Record<string, unknown> | null;
	timeoutMs: number | null;
}

export interface WorkflowRunResponse {
	id: string;
	workflowName: string;
	status: string;
	triggerType: string;
	triggerData: Record<string, unknown> | null;
	error: string | null;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
	totalAiTokens: number;
	createdAt: string;
	steps: WorkflowStepResponse[];
}

export interface WorkflowStepResponse {
	id: string;
	stepIndex: number;
	stepId: string;
	stepType: string;
	status: string;
	output: unknown | null;
	error: string | null;
	retryCount: number;
	aiTokensUsed: number;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
}

export interface TriggerWorkflowRequest {
	input?: Record<string, unknown>;
}

export const TriggerWorkflowRequestSchema: z.ZodType<TriggerWorkflowRequest> =
	z.object({
		input: z.record(z.string(), z.unknown()).optional(),
	});
