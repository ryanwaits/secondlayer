import { BaseClient } from "../base.ts";

export type SubscriptionStatus = "active" | "paused" | "error";
export type SubscriptionFormat =
	| "standard-webhooks"
	| "inngest"
	| "trigger"
	| "cloudflare"
	| "cloudevents"
	| "raw";
export type SubscriptionRuntime = "inngest" | "trigger" | "cloudflare" | "node";

export interface SubscriptionSummary {
	id: string;
	name: string;
	status: SubscriptionStatus;
	subgraphName: string;
	tableName: string;
	format: SubscriptionFormat;
	runtime: SubscriptionRuntime | null;
	url: string;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SubscriptionDetail extends SubscriptionSummary {
	filter: Record<string, unknown>;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastError: string | null;
}

export interface CreateSubscriptionRequest {
	name: string;
	subgraphName: string;
	tableName: string;
	url: string;
	filter?: Record<string, unknown>;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface CreateSubscriptionResponse {
	subscription: SubscriptionDetail;
	/** Plaintext signing secret — surfaced ONCE. Store it server-side. */
	signingSecret: string;
}

export interface UpdateSubscriptionRequest {
	name?: string;
	url?: string;
	filter?: Record<string, unknown>;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime | null;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface RotateSecretResponse {
	subscription: SubscriptionDetail;
	signingSecret: string;
}

export class Subscriptions extends BaseClient {
	async list(): Promise<{ data: SubscriptionSummary[] }> {
		return this.request<{ data: SubscriptionSummary[] }>(
			"GET",
			"/api/subscriptions",
		);
	}

	async get(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>("GET", `/api/subscriptions/${id}`);
	}

	async create(
		input: CreateSubscriptionRequest,
	): Promise<CreateSubscriptionResponse> {
		return this.request<CreateSubscriptionResponse>(
			"POST",
			"/api/subscriptions",
			input,
		);
	}

	async update(
		id: string,
		patch: UpdateSubscriptionRequest,
	): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"PATCH",
			`/api/subscriptions/${id}`,
			patch,
		);
	}

	async pause(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"POST",
			`/api/subscriptions/${id}/pause`,
		);
	}

	async resume(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"POST",
			`/api/subscriptions/${id}/resume`,
		);
	}

	async delete(id: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>("DELETE", `/api/subscriptions/${id}`);
	}

	async rotateSecret(id: string): Promise<RotateSecretResponse> {
		return this.request<RotateSecretResponse>(
			"POST",
			`/api/subscriptions/${id}/rotate-secret`,
		);
	}
}
