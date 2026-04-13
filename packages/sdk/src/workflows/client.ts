import type { WorkflowRun, WorkflowRunStatus } from "@secondlayer/workflows";
import { BaseClient } from "../base.ts";
import { ApiError, VersionConflictError } from "../errors.ts";

function parseSseChunk(raw: string): WorkflowTailEvent | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of raw.split("\n")) {
		if (line.startsWith("event:")) {
			event = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart());
		}
	}
	if (dataLines.length === 0) return null;
	const data = dataLines.join("\n");
	try {
		const parsed = JSON.parse(data);
		switch (event) {
			case "step":
				return { type: "step", step: parsed as WorkflowStepEvent };
			case "done":
				return { type: "done", done: parsed as WorkflowRunDoneEvent };
			case "heartbeat":
				return {
					type: "heartbeat",
					ts: typeof parsed === "string" ? parsed : String(parsed),
				};
			case "timeout":
				return {
					type: "timeout",
					message: (parsed as { message?: string }).message ?? "timeout",
				};
			default:
				return null;
		}
	} catch {
		return null;
	}
}

export interface WorkflowSource {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	reason?: string;
	updatedAt: string;
}

export interface WorkflowStepEvent {
	id: string;
	stepIndex: number;
	stepId: string;
	stepType: string;
	status: string;
	output?: unknown;
	error: string | null;
	retryCount: number;
	aiTokensUsed: number;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
	ts: string;
}

export interface WorkflowRunDoneEvent {
	runId: string;
	status: string;
	error?: string | null;
	completedAt?: string | null;
}

export type WorkflowTailEvent =
	| { type: "step"; step: WorkflowStepEvent }
	| { type: "done"; done: WorkflowRunDoneEvent }
	| { type: "heartbeat"; ts: string }
	| { type: "timeout"; message: string };

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

	async rollback(
		name: string,
		toVersion?: string,
	): Promise<{
		action: "rolled-back";
		name: string;
		fromVersion: string;
		restoredFromVersion: string;
		version: string;
	}> {
		return this.request(
			"POST",
			`/api/workflows/${name}/rollback`,
			toVersion ? { toVersion } : {},
		);
	}

	/**
	 * Subscribe to a workflow run's server-sent event stream. Resolves when the
	 * run completes, times out, or the signal is aborted. Throws on HTTP errors
	 * opening the stream.
	 */
	async streamRun(
		name: string,
		runId: string,
		onEvent: (event: WorkflowTailEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const url = `${this.baseUrl}/api/workflows/${name}/runs/${runId}/stream`;
		const headers: Record<string, string> = {
			Accept: "text/event-stream",
			"x-sl-origin": this.origin,
		};
		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}

		const res = await fetch(url, { headers, signal });
		if (!res.ok || !res.body) {
			throw new ApiError(
				res.status,
				`Failed to open workflow run stream (HTTP ${res.status})`,
			);
		}

		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;

			let sep = buffer.indexOf("\n\n");
			while (sep !== -1) {
				const chunk = buffer.slice(0, sep);
				buffer = buffer.slice(sep + 2);
				const parsed = parseSseChunk(chunk);
				if (parsed) {
					onEvent(parsed);
					if (parsed.type === "done" || parsed.type === "timeout") {
						await reader.cancel().catch(() => undefined);
						return;
					}
				}
				sep = buffer.indexOf("\n\n");
			}
		}
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
