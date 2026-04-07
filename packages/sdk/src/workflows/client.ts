import type {
	WorkflowRun,
	WorkflowRunStatus,
} from "@secondlayer/workflows";
import { BaseClient } from "../base.ts";
import { ApiError } from "../errors.ts";

export interface WorkflowSummary {
	name: string;
	status: "active" | "paused";
	triggerType: "event" | "stream" | "schedule" | "manual";
	createdAt: string;
	updatedAt: string;
}

export interface WorkflowDetail extends WorkflowSummary {
	trigger: Record<string, unknown>;
	retries?: { maxAttempts?: number; backoffMs?: number };
	timeout?: number;
	totalRuns: number;
	lastRunAt: string | null;
}

export interface WorkflowRunSummary {
	id: string;
	workflowName: string;
	status: WorkflowRunStatus;
	duration: number;
	aiTokensUsed: number;
	triggeredAt: string;
	completedAt: string | null;
}

function notYet(): never {
	throw new ApiError(501, "Workflows API not yet available");
}

export class Workflows extends BaseClient {
	async list(): Promise<{ workflows: WorkflowSummary[] }> {
		return notYet();
	}

	async get(_name: string): Promise<WorkflowDetail> {
		return notYet();
	}

	async trigger(
		_name: string,
		_input?: Record<string, unknown>,
	): Promise<{ runId: string }> {
		return notYet();
	}

	async pause(_name: string): Promise<void> {
		return notYet();
	}

	async resume(_name: string): Promise<void> {
		return notYet();
	}

	async delete(_name: string): Promise<void> {
		return notYet();
	}

	async listRuns(
		_name: string,
		_params?: { status?: WorkflowRunStatus; limit?: number },
	): Promise<{ runs: WorkflowRunSummary[] }> {
		return notYet();
	}

	async getRun(_runId: string): Promise<WorkflowRun> {
		return notYet();
	}
}
