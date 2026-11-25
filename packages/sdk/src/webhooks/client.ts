import type {
	CreateWebhookRequest,
	CreateWebhookResponse,
	DeadRow,
	DeliveriesPage,
	DeliveriesQuery,
	ReplayResult,
	RotateSecretResponse,
	UpdateWebhookRequest,
	WebhookActivity,
	WebhookDeliveryDetail,
	WebhookDetail,
	WebhookSummary,
	WebhookTestResult,
} from "@secondlayer/shared/schemas/webhooks";
import { BaseClient, buildQuery, seg } from "../base.ts";

export type {
	ChainTrigger,
	ChainTriggerType,
	CreateWebhookRequest,
	CreateWebhookResponse,
	DeadRow,
	DeliveriesPage,
	DeliveriesQuery,
	DeliveryRow,
	ReplayResult,
	RotateSecretResponse,
	WebhookActivity,
	WebhookActivityHour,
	WebhookAuth,
	WebhookDeliveryDetail,
	WebhookDetail,
	WebhookFormat,
	WebhookKind,
	WebhookStatus,
	WebhookSummary,
	WebhookTestResult,
	UpdateWebhookRequest,
} from "@secondlayer/shared/schemas/webhooks";

export { trigger } from "@secondlayer/shared/schemas/webhooks";

const LIST_PAGE_MAX = 200;

export class Webhooks extends BaseClient {
	/**
	 * List one page of your webhooks, newest first.
	 *
	 * `limit` is 1 to 200 (default 50); `offset` skips that many. Use
	 * {@link Webhooks.listAll} to read every webhook. Each summary has the
	 * status, format, URL, last delivery and last success, and the circuit
	 * breaker state (`circuitFailures`, `circuitOpenedAt`).
	 */
	async list(
		opts: { limit?: number; offset?: number } = {},
	): Promise<{ data: WebhookSummary[] }> {
		return this.request<{ data: WebhookSummary[] }>(
			"GET",
			`/api/webhooks${buildQuery({ _limit: opts.limit, _offset: opts.offset })}`,
		);
	}

	/** Every webhook on the account, newest first, read 200 at a time. */
	async listAll(): Promise<WebhookSummary[]> {
		const all: WebhookSummary[] = [];
		for (;;) {
			const { data } = await this.list({
				limit: LIST_PAGE_MAX,
				offset: all.length,
			});
			all.push(...data);
			if (data.length < LIST_PAGE_MAX) return all;
		}
	}

	/**
	 * Get one webhook's full configuration.
	 *
	 * Adds the triggers, the receiver's auth (redacted to header names and whether a secret is set), the retry and timeout limits, `lastError`, and a `warning` when this instance's trigger evaluator is not running.
	 */
	async get(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>("GET", `/api/webhooks/${seg(id)}`);
	}

	/**
	 * Create a webhook that POSTs chain events to your URL.
	 *
	 * Takes a `name`, a `url`, and `triggers` built with `trigger.*`; each trigger is validated before anything is provisioned, and an invalid one is a 400. The signing secret comes back once in `signingSecret`, so store it. A webhook starts at the chain tip and never backfills: use {@link replay} for history. Hosted accounts cap `maxRetries` at 7 and `timeoutMs` at 30000.
	 */
	async create(input: CreateWebhookRequest): Promise<CreateWebhookResponse> {
		return this.request<CreateWebhookResponse>("POST", "/api/webhooks", input);
	}

	/**
	 * Change a webhook's name, URL, format, auth, or delivery limits.
	 *
	 * Send only the fields to change: `name`, `url`, `format`, `authConfig`, `maxRetries`, `timeoutMs`, `concurrency`. Triggers are not part of an update. Resolves to the updated webhook.
	 */
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

	/**
	 * Stop deliveries without deleting the webhook.
	 *
	 * Resolves to the updated webhook. {@link resume} turns it back on.
	 */
	async pause(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>(
			"POST",
			`/api/webhooks/${seg(id)}/pause`,
		);
	}

	/**
	 * Start delivering again after a pause.
	 *
	 * Also clears a circuit-breaker pause, which happens after 20 straight failed deliveries. Resolves to the updated webhook.
	 */
	async resume(id: string): Promise<WebhookDetail> {
		return this.request<WebhookDetail>(
			"POST",
			`/api/webhooks/${seg(id)}/resume`,
		);
	}

	/**
	 * Delete a webhook.
	 *
	 * Resolves to `{ ok: true }`. Throws a 404 when the webhook does not exist.
	 */
	async delete(id: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>("DELETE", `/api/webhooks/${seg(id)}`);
	}

	/**
	 * Issue a new signing secret.
	 *
	 * The new secret comes back once in `signingSecret`. Update the receiver that calls `verifyWebhookSignature` with it: deliveries are signed with the new secret from now on.
	 */
	async rotateSecret(id: string): Promise<RotateSecretResponse> {
		return this.request<RotateSecretResponse>(
			"POST",
			`/api/webhooks/${seg(id)}/rotate-secret`,
		);
	}

	/** Send a one-off test delivery to a webhook's URL.
	 *
	 *  Built for the webhook's format and SSRF-guarded. Logged as a delivery
	 *  row, visible via `deliveries`. */
	async test(id: string): Promise<WebhookTestResult> {
		return this.request<WebhookTestResult>(
			"POST",
			`/api/webhooks/${seg(id)}/test`,
		);
	}

	/** One page of delivery attempts, newest first, up to 100.
	 *
	 *  Pass `next_cursor` back as `cursor` for the next page. Narrow by
	 *  dispatch window (`from`/`to`, ISO timestamps, at most 31 days), by
	 *  transaction (`txId`) or by block height (`fromHeight`/`toHeight`);
	 *  `total` counts every attempt that matches. Attempts are kept 30 days. */
	async deliveries(
		id: string,
		query: DeliveriesQuery = {},
	): Promise<DeliveriesPage> {
		return this.request<DeliveriesPage>(
			"GET",
			`/api/webhooks/${seg(id)}/deliveries${buildQuery({
				from: query.from,
				to: query.to,
				tx_id: query.txId,
				from_height: query.fromHeight,
				to_height: query.toHeight,
				cursor: query.cursor,
				_limit: query.limit,
			})}`,
		);
	}

	/** Get a webhook's hourly delivery counts for the last 7 days.
	 *
	 *  Each hour has delivered, waiting, and gave-up counts, plus the current
	 *  queue depth, failed attempts per hour, the usual band, and 30 daily
	 *  totals. This is the events chart on the detail page. `{ days: 30 }` is
	 *  accepted for older servers, which only send the daily totals when asked. */
	async activity(id: string, opts?: { days?: 30 }): Promise<WebhookActivity> {
		return this.request<WebhookActivity>(
			"GET",
			`/api/webhooks/${seg(id)}/activity${buildQuery({ days: opts?.days })}`,
		);
	}

	/** Get one delivery attempt with its payload and response.
	 *
	 *  Includes the outbox context (payload, response headers). This is the
	 *  delivery card on the detail page. */
	async delivery(
		id: string,
		deliveryId: string,
	): Promise<WebhookDeliveryDetail> {
		return this.request<WebhookDeliveryDetail>(
			"GET",
			`/api/webhooks/${seg(id)}/deliveries/${seg(deliveryId)}`,
		);
	}

	/**
	 * Re-deliver historical events over an existing webhook.
	 *
	 * Pass `fromBlock` and `toBlock`; the range is capped at 100,000 blocks. A replay is historical only and never moves the live cursor. It is idempotent: the same range twice is a no-op, so pass any string as `force` to re-deliver it. Replays carry `is_replay` and use the standard `chain.{type}.apply` envelope. Resolves to `replayId`, `enqueuedCount`, and `scannedCount`. A second replay while one is running is a 409. `sbtc_withdrawal_swept_confirmed` is forward-only and never replayed. Hosted accounts get 5 replays an hour.
	 */
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

	/**
	 * List the events a webhook gave up delivering.
	 *
	 * Returns up to 100 dead-lettered events, newest failure first. Each row's `id` is what {@link requeue} takes.
	 */
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
