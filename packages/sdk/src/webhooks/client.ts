import type {
	CreateWebhookRequest,
	CreateWebhookResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	UpdateWebhookRequest,
	WebhookDetail,
	WebhookSummary,
	WebhookTestResult,
} from "@secondlayer/shared/schemas/webhooks";
import { BaseClient, seg } from "../base.ts";

export type {
	ChainTrigger,
	ChainTriggerType,
	CreateWebhookRequest,
	CreateWebhookResponse,
	DeadRow,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	WebhookDetail,
	WebhookFormat,
	WebhookKind,
	WebhookRuntime,
	WebhookStatus,
	WebhookSummary,
	WebhookTestResult,
	UpdateWebhookRequest,
} from "@secondlayer/shared/schemas/webhooks";

// `trigger.*` chain-trigger builders for chain webhooks
// (`create({ triggers: [trigger.contractCall({ ... })] })`).
export { trigger } from "@secondlayer/shared/schemas/webhooks";

export class Webhooks extends BaseClient {
	async list(): Promise<{ data: WebhookSummary[] }> {
		return this.request<{ data: WebhookSummary[] }>("GET", "/api/webhooks");
	}

	async get(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>("GET", `/api/webhooks/${seg(id)}`);
	}

	async create(input: CreateWebhookRequest): Promise<CreateWebhookResponse> {
		return this.request<CreateWebhookResponse>("POST", "/api/webhooks", input);
	}

	async update(
		id: string,
		patch: UpdateWebhookRequest,
	): Promise<WebhookDetail> {
		return this.request<WebhookDetail>(
			"PATCH",
			`/api/webhooks/${seg(id)}`,
			patch,
		);
	}

	async pause(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>(
			"POST",
			`/api/webhooks/${seg(id)}/pause`,
		);
	}

	async resume(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>(
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

	/** Send a one-off test webhook to the webhook's URL (built for its
	 *  format, SSRF-guarded). Logged as a delivery row, visible via deliveries. */
	async test(id: string): Promise<WebhookTestResult> {
		return this.request<WebhookTestResult>(
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
