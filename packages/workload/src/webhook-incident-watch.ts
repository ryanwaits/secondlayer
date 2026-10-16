/**
 * Webhook outage watch. Webhook state lives in each tenant's own stack
 * database; account emails and the email sender live on the platform. The
 * workload host is the one trusted process that reaches both, so every minute
 * it reads each running tenant's webhooks over loopback (instance token) and
 * posts the full picture to `POST /internal/webhook-incidents` with the
 * workload host key. The platform decides what is new and sends the email.
 * Tenant stacks never hold a platform credential or call the platform.
 */

import { logger } from "@secondlayer/shared";
import { type TenantRow, listRunningTenants } from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";
import {
	type TenantEndpoint,
	tenantEndpoint as realTenantEndpoint,
} from "./processor-watch.ts";
import type { ProvisionerConfig } from "./provisioner.ts";

/** Consecutive failed attempts (the tenant counter resets on any success). */
export const DOWN_MIN_FAILURES = 5;
/** No successful delivery for this long. */
export const DOWN_MIN_MS = 15 * 60_000;

const TENANT_TIMEOUT_MS = 5_000;
const LIST_LIMIT = 200;

/** The subset of the tenant `GET /api/webhooks` summary this watch reads. */
export interface WebhookSummaryLike {
	id: string;
	name: string;
	status: string;
	url: string;
	lastSuccessAt: string | null;
	circuitOpenedAt: string | null;
	circuitFailures: number;
	managedBy?: string | null;
	createdAt: string;
	lastError?: string | null;
}

export interface DownWebhook {
	id: string;
	name: string;
	host: string;
	failingSince: string;
	failures: number;
	lastError: string | null;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	}
}

/** Locked definition of "down": 5+ failures in a row and no success for 15
 *  minutes. A manual pause is never down; a circuit pause is. Webhooks managed
 *  by another product are skipped: their receiver is not the customer's. */
export function downWebhooks(
	list: WebhookSummaryLike[],
	now: number,
): DownWebhook[] {
	const down: DownWebhook[] = [];
	for (const w of list) {
		if (w.managedBy != null) continue;
		if (w.status === "paused" && w.circuitOpenedAt === null) continue;
		if (w.circuitFailures < DOWN_MIN_FAILURES) continue;
		const failingSince = w.lastSuccessAt ?? w.createdAt;
		if (now - Date.parse(failingSince) < DOWN_MIN_MS) continue;
		down.push({
			id: w.id,
			name: w.name,
			host: hostOf(w.url),
			failingSince,
			failures: w.circuitFailures,
			lastError: w.lastError ? w.lastError.slice(0, 200) : null,
		});
	}
	return down;
}

export interface WebhookIncidentWatchDeps {
	fetchImpl?: FetchLike;
	listTenants?: () => Promise<TenantRow[]>;
	endpointFor?: (tenant: TenantRow) => TenantEndpoint | null;
	now?: () => number;
}

/** One tick: report every running tenant. Never throws; a failing tenant or
 *  post is logged and skipped. */
export function createWebhookIncidentWatch(
	cfg: ProvisionerConfig,
	platform: { appServerUrl: string; workloadHostKey: string },
	deps: WebhookIncidentWatchDeps = {},
): () => Promise<void> {
	const doFetch: FetchLike = deps.fetchImpl ?? fetch;
	const listTenants = deps.listTenants ?? (() => listRunningTenants(cfg.db));
	const endpointFor =
		deps.endpointFor ?? ((tenant) => realTenantEndpoint(cfg, tenant));
	const now = deps.now ?? Date.now;
	const postUrl = `${platform.appServerUrl.replace(/\/+$/, "")}/internal/webhook-incidents`;

	async function reportTenant(tenant: TenantRow): Promise<void> {
		const endpoint = endpointFor(tenant);
		if (!endpoint) return;

		let list: WebhookSummaryLike[];
		try {
			const res = await doFetch(
				`${endpoint.baseUrl}/api/webhooks?_limit=${LIST_LIMIT}`,
				{
					headers: { authorization: `Bearer ${endpoint.instanceToken}` },
					signal: AbortSignal.timeout(TENANT_TIMEOUT_MS),
				},
			);
			if (!res.ok) throw new Error(`tenant api ${res.status}`);
			const body = (await res.json()) as { data?: WebhookSummaryLike[] };
			list = body.data ?? [];
		} catch (err) {
			logger.warn("workload.webhook_incidents.tenant_failed", {
				accountId: tenant.account_id,
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		const observedAt = now();
		try {
			const res = await doFetch(postUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${platform.workloadHostKey}`,
				},
				body: JSON.stringify({
					accountId: tenant.account_id,
					observedAt: new Date(observedAt).toISOString(),
					webhookIds: list.map((w) => w.id),
					down: downWebhooks(list, observedAt),
				}),
				signal: AbortSignal.timeout(TENANT_TIMEOUT_MS),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`app-server ${res.status} ${text.slice(0, 200)}`);
			}
		} catch (err) {
			logger.warn("workload.webhook_incidents.post_failed", {
				accountId: tenant.account_id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return async () => {
		let tenants: TenantRow[];
		try {
			tenants = await listTenants();
		} catch (err) {
			logger.warn("workload.webhook_incidents.tenant_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		for (const tenant of tenants) await reportTenant(tenant);
	};
}
