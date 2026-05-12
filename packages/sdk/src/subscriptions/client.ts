import type {
	CreateSubscriptionRequest,
	CreateSubscriptionResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	SubscriptionDetail,
	SubscriptionSummary,
	UpdateSubscriptionRequest,
} from "@secondlayer/shared/schemas/subscriptions";
import { BaseClient } from "../base.ts";

export type {
	CreateSubscriptionRequest,
	CreateSubscriptionResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	SubscriptionDetail,
	SubscriptionFormat,
	SubscriptionRuntime,
	SubscriptionStatus,
	SubscriptionSummary,
	UpdateSubscriptionRequest,
} from "@secondlayer/shared/schemas/subscriptions";

export class Subscriptions extends BaseClient {
	async list(): Promise<{ data: SubscriptionSummary[] }> {
		return this.requestAtTenant<{ data: SubscriptionSummary[] }>(
			"GET",
			"/api/subscriptions",
		);
	}

	async get(id: string): Promise<SubscriptionDetail> {
		return this.requestAtTenant<SubscriptionDetail>(
			"GET",
			`/api/subscriptions/${id}`,
		);
	}

	async create(
		input: CreateSubscriptionRequest,
	): Promise<CreateSubscriptionResponse> {
		return this.requestAtTenant<CreateSubscriptionResponse>(
			"POST",
			"/api/subscriptions",
			input,
		);
	}

	async update(
		id: string,
		patch: UpdateSubscriptionRequest,
	): Promise<SubscriptionDetail> {
		return this.requestAtTenant<SubscriptionDetail>(
			"PATCH",
			`/api/subscriptions/${id}`,
			patch,
		);
	}

	async pause(id: string): Promise<SubscriptionDetail> {
		return this.requestAtTenant<SubscriptionDetail>(
			"POST",
			`/api/subscriptions/${id}/pause`,
		);
	}

	async resume(id: string): Promise<SubscriptionDetail> {
		return this.requestAtTenant<SubscriptionDetail>(
			"POST",
			`/api/subscriptions/${id}/resume`,
		);
	}

	async delete(id: string): Promise<{ ok: true }> {
		return this.requestAtTenant<{ ok: true }>(
			"DELETE",
			`/api/subscriptions/${id}`,
		);
	}

	async rotateSecret(id: string): Promise<RotateSecretResponse> {
		return this.requestAtTenant<RotateSecretResponse>(
			"POST",
			`/api/subscriptions/${id}/rotate-secret`,
		);
	}

	async recentDeliveries(id: string): Promise<{ data: DeliveryRow[] }> {
		return this.requestAtTenant<{ data: DeliveryRow[] }>(
			"GET",
			`/api/subscriptions/${id}/deliveries`,
		);
	}

	async replay(
		id: string,
		range: { fromBlock: number; toBlock: number },
	): Promise<ReplayResult> {
		return this.requestAtTenant<ReplayResult>(
			"POST",
			`/api/subscriptions/${id}/replay`,
			range,
		);
	}

	async dead(id: string): Promise<{ data: DeadRow[] }> {
		return this.requestAtTenant<{ data: DeadRow[] }>(
			"GET",
			`/api/subscriptions/${id}/dead`,
		);
	}

	async requeueDead(id: string, outboxId: string): Promise<{ ok: true }> {
		return this.requestAtTenant<{ ok: true }>(
			"POST",
			`/api/subscriptions/${id}/dead/${outboxId}/requeue`,
		);
	}
}
