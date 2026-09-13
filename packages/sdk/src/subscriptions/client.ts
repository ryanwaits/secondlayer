import type {
	CreateWebhookRequest as CreateSubscriptionRequest,
	CreateWebhookResponse as CreateSubscriptionResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	WebhookDetail as SubscriptionDetail,
	WebhookSummary as SubscriptionSummary,
	WebhookTestResult as SubscriptionTestResult,
	UpdateWebhookRequest as UpdateSubscriptionRequest,
} from "@secondlayer/shared/schemas/webhooks";
import { BaseClient, seg } from "../base.ts";

export type {
	ChainTrigger,
	ChainTriggerType,
	CreateWebhookRequest as CreateSubscriptionRequest,
	CreateWebhookResponse as CreateSubscriptionResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	WebhookDetail as SubscriptionDetail,
	WebhookFormat as SubscriptionFormat,
	WebhookKind as SubscriptionKind,
	WebhookRuntime as SubscriptionRuntime,
	WebhookStatus as SubscriptionStatus,
	WebhookSummary as SubscriptionSummary,
	WebhookTestResult as SubscriptionTestResult,
	UpdateWebhookRequest as UpdateSubscriptionRequest,
} from "@secondlayer/shared/schemas/webhooks";
// `trigger.*` chain-trigger builders for direct chain-level subscriptions
// (`create({ triggers: [trigger.contractCall({ ... })] })`).
export { trigger } from "@secondlayer/shared/schemas/webhooks";

export class Subscriptions extends BaseClient {
	async list(): Promise<{ data: SubscriptionSummary[] }> {
		return this.request<{ data: SubscriptionSummary[] }>(
			"GET",
			"/api/webhooks",
		);
	}

	async get(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>("GET", `/api/webhooks/${seg(id)}`);
	}

	async create(
		input: CreateSubscriptionRequest,
	): Promise<CreateSubscriptionResponse> {
		return this.request<CreateSubscriptionResponse>(
			"POST",
			"/api/webhooks",
			input,
		);
	}

	async update(
		id: string,
		patch: UpdateSubscriptionRequest,
	): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"PATCH",
			`/api/webhooks/${seg(id)}`,
			patch,
		);
	}

	async pause(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"POST",
			`/api/webhooks/${seg(id)}/pause`,
		);
	}

	async resume(id: string): Promise<SubscriptionDetail> {
		return this.request<SubscriptionDetail>(
			"POST",
			`/api/webhooks/${seg(id)}/resume`,
		);
	}

	async delete(id: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>("DELETE", `/api/webhooks/${seg(id)}`);
	}

	async rotateSecret(id: string): Promise<RotateSecretResponse> {
		return this.request<RotateSecretResponse>(
			"POST",
			`/api/webhooks/${seg(id)}/rotate-secret`,
		);
	}

	/** Send a one-off test webhook to the subscription's URL (built for its
	 *  format, SSRF-guarded). Logged as a delivery row, visible via deliveries. */
	async test(id: string): Promise<SubscriptionTestResult> {
		return this.request<SubscriptionTestResult>(
			"POST",
			`/api/webhooks/${seg(id)}/test`,
		);
	}

	/** The last 100 delivery attempts, newest first. The server caps the window;
	 *  there is nothing to page. */
	async deliveries(id: string): Promise<{ data: DeliveryRow[] }> {
		return this.request<{ data: DeliveryRow[] }>(
			"GET",
			`/api/webhooks/${seg(id)}/deliveries`,
		);
	}

	async replay(
		id: string,
		range: { fromBlock: number; toBlock: number; force?: string },
	): Promise<ReplayResult> {
		return this.request<ReplayResult>(
			"POST",
			`/api/webhooks/${seg(id)}/replay`,
			range,
		);
	}

	async dead(id: string): Promise<{ data: DeadRow[] }> {
		return this.request<{ data: DeadRow[] }>(
			"GET",
			`/api/webhooks/${seg(id)}/dead`,
		);
	}

	/** Push one dead-lettered event back onto the delivery queue. `outboxId` is
	 *  the `id` of a row from {@link dead}. */
	async requeue(id: string, outboxId: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>(
			"POST",
			`/api/webhooks/${seg(id)}/dead/${seg(outboxId)}/requeue`,
		);
	}
}
