import type {
	WorkflowRun,
	WorkflowRunStatus,
} from "@secondlayer/workflows";
import { BaseClient } from "../base.ts";

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

export class Workflows extends BaseClient {
	async deploy(data: {
		name: string;
		trigger: Record<string, unknown>;
		handlerCode: string;
		retries?: Record<string, unknown>;
		timeout?: number;
	}): Promise<{ action: string; workflowId: string; message: string }> {
		return this.request("POST", "/api/workflows", data);
	}

	async list(): Promise<{ workflows: WorkflowSummary[] }> {
		return this.request("GET", "/api/workflows");
	}

	async get(name: string): Promise<WorkflowDetail> {
		return this.request("GET", `/api/workflows/${name}`);
	}

	async trigger(
		name: string,
		input?: Record<string, unknown>,
	): Promise<{ runId: string }> {
		return this.request("POST", `/api/workflows/${name}/trigger`, input ? { input } : undefined);
	}

	async pause(name: string): Promise<void> {
		return this.request("POST", `/api/workflows/${name}/pause`);
	}

	async resume(name: string): Promise<void> {
		return this.request("POST", `/api/workflows/${name}/resume`);
	}

	async delete(name: string): Promise<void> {
		return this.request("DELETE", `/api/workflows/${name}`);
	}

	async listRuns(
		name: string,
		params?: { status?: WorkflowRunStatus; limit?: number },
	): Promise<{ runs: WorkflowRunSummary[] }> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set("status", params.status);
		if (params?.limit !== undefined) qs.set("limit", String(params.limit));
		const query = qs.toString();
		return this.request("GET", `/api/workflows/${name}/runs${query ? `?${query}` : ""}`);
	}

	async getRun(runId: string): Promise<WorkflowRun> {
		return this.request("GET", `/api/workflows/runs/${runId}`);
	}
}
