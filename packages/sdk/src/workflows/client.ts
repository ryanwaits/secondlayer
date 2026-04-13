import type { WorkflowRun, WorkflowRunStatus } from "@secondlayer/workflows";
import { BaseClient } from "../base.ts";
import { ApiError, VersionConflictError } from "../errors.ts";

export interface WorkflowSource {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	reason?: string;
	updatedAt: string;
}

export interface DeployDryRunResponse {
	valid: boolean;
	validation?: { name: string; triggerType: string };
	bundleSize: number;
	error?: string;
}

export interface DeployResponse {
	action: "created" | "updated";
	workflowId: string;
	version: string;
	message: string;
}

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
	async deploy(
		data: {
			name: string;
			trigger: Record<string, unknown>;
			handlerCode: string;
			sourceCode?: string;
			expectedVersion?: string;
			retries?: Record<string, unknown>;
			timeout?: number;
		} & { dryRun?: false },
	): Promise<DeployResponse>;
	async deploy(data: {
		name: string;
		trigger: Record<string, unknown>;
		handlerCode: string;
		sourceCode?: string;
		expectedVersion?: string;
		retries?: Record<string, unknown>;
		timeout?: number;
		dryRun: true;
	}): Promise<DeployDryRunResponse>;
	async deploy(data: {
		name: string;
		trigger: Record<string, unknown>;
		handlerCode: string;
		sourceCode?: string;
		expectedVersion?: string;
		dryRun?: boolean;
		retries?: Record<string, unknown>;
		timeout?: number;
	}): Promise<DeployResponse | DeployDryRunResponse> {
		try {
			return await this.request("POST", "/api/workflows", data);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				const body = err.body as
					| { currentVersion?: string; expectedVersion?: string }
					| undefined;
				if (body?.currentVersion && body.expectedVersion) {
					throw new VersionConflictError(
						body.currentVersion,
						body.expectedVersion,
						err.message,
					);
				}
			}
			throw err;
		}
	}

	async getSource(name: string): Promise<WorkflowSource> {
		return this.request("GET", `/api/workflows/${name}/source`);
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
		return this.request(
			"POST",
			`/api/workflows/${name}/trigger`,
			input ? { input } : undefined,
		);
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
		return this.request(
			"GET",
			`/api/workflows/${name}/runs${query ? `?${query}` : ""}`,
		);
	}

	async getRun(runId: string): Promise<WorkflowRun> {
		return this.request("GET", `/api/workflows/runs/${runId}`);
	}
}
