/**
 * Push signals only the workload host can see. Replays live in each tenant's
 * stack database, and a subgraph stopping is seen by the processor watch; the
 * platform owns the phones. Every minute this reads each running tenant's
 * recent replays over loopback (instance token) and posts the finished ones
 * to `POST /internal/push` with the workload host key. A subgraph stop from
 * the processor watch (`onStopped`) goes to the same route through the same
 * `postPush`. The platform builds the copy and debounces. Tenant insights are
 * never read or forwarded.
 */

import { logger } from "@secondlayer/shared";
import { type TenantRow, listRunningTenants } from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";
import {
	type SubgraphStoppedEvent,
	type TenantEndpoint,
	tenantEndpoint as realTenantEndpoint,
} from "./processor-watch.ts";
import type { ProvisionerConfig } from "./provisioner.ts";

const TENANT_TIMEOUT_MS = 5_000;
const REPLAY_LIMIT = 50;
const WEBHOOK_LIMIT = 200;
/** A replay that finished longer ago than this is never reported. */
export const REPLAY_WINDOW_MS = 30 * 60_000;

export interface PushPlatform {
	appServerUrl: string;
	workloadHostKey: string;
}

/** What `POST /internal/push` accepts (minus `observedAt`, added when posting). */
export interface PushBody {
	accountId: string;
	replays?: Array<{
		replayId: string;
		webhookId: string;
		webhookName: string;
		finishedAt: string;
		delivered: number;
		gaveUp: number;
		total: number;
	}>;
	stopped?: Array<{
		subgraph: string;
		reason: SubgraphStoppedEvent["reason"];
		height: number;
		lastError: string | null;
	}>;
}

/** Posts one push report with the host key. Never throws; a failure is logged. */
export async function postPush(
	platform: PushPlatform,
	body: PushBody,
	observedAt: number = Date.now(),
	doFetch: FetchLike = fetch,
): Promise<void> {
	try {
		const res = await doFetch(
			`${platform.appServerUrl.replace(/\/+$/, "")}/internal/push`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${platform.workloadHostKey}`,
				},
				body: JSON.stringify({
					...body,
					observedAt: new Date(observedAt).toISOString(),
				}),
				signal: AbortSignal.timeout(TENANT_TIMEOUT_MS),
			},
		);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`app-server ${res.status} ${text.slice(0, 200)}`);
		}
	} catch (err) {
		logger.warn("workload.push_watch.post_failed", {
			accountId: body.accountId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/** The processor watch's `onStopped`: one report per stopped subgraph. */
export function createStoppedReporter(
	platform: PushPlatform,
	deps: { fetchImpl?: FetchLike; now?: () => number } = {},
): (event: SubgraphStoppedEvent) => Promise<void> {
	return (event) =>
		postPush(
			platform,
			{
				accountId: event.accountId,
				stopped: [
					{
						subgraph: event.subgraph,
						reason: event.reason,
						height: event.height,
						lastError: event.lastError,
					},
				],
			},
			(deps.now ?? Date.now)(),
			deps.fetchImpl,
		);
}

interface ReplayLike {
	replayId: string;
	webhookId: string;
	status: string;
	total: number;
	delivered: number | null;
	gaveUp: number | null;
	finishedAt: string | null;
}

export interface PushWatchDeps {
	fetchImpl?: FetchLike;
	listTenants?: () => Promise<TenantRow[]>;
	endpointFor?: (tenant: TenantRow) => TenantEndpoint | null;
	now?: () => number;
}

/** One tick: report finished replays for every running tenant. Never throws;
 *  a failing tenant or post is logged and skipped. */
export function createPushWatch(
	cfg: ProvisionerConfig,
	platform: PushPlatform,
	deps: PushWatchDeps = {},
): () => Promise<void> {
	const doFetch: FetchLike = deps.fetchImpl ?? fetch;
	const listTenants = deps.listTenants ?? (() => listRunningTenants(cfg.db));
	const endpointFor =
		deps.endpointFor ?? ((tenant) => realTenantEndpoint(cfg, tenant));
	const now = deps.now ?? Date.now;

	async function getData<T>(
		endpoint: TenantEndpoint,
		path: string,
	): Promise<{ status: number; data: T[] }> {
		const res = await doFetch(`${endpoint.baseUrl}${path}`, {
			headers: { authorization: `Bearer ${endpoint.instanceToken}` },
			signal: AbortSignal.timeout(TENANT_TIMEOUT_MS),
		});
		if (!res.ok) return { status: res.status, data: [] };
		const body = (await res.json()) as { data?: T[] };
		return { status: res.status, data: body.data ?? [] };
	}

	async function reportTenant(tenant: TenantRow): Promise<void> {
		const endpoint = endpointFor(tenant);
		if (!endpoint) return;

		let replays: NonNullable<PushBody["replays"]>;
		try {
			const observedAt = now();
			const recent = await getData<ReplayLike>(
				endpoint,
				`/api/webhooks/replays?_limit=${REPLAY_LIMIT}`,
			);
			// A stack from before replays were recorded answers 404: no replays.
			if (recent.status === 404) return;
			if (recent.status >= 400) {
				throw new Error(`tenant api ${recent.status}`);
			}
			const finished = recent.data.filter(
				(r) =>
					r.status === "done" &&
					r.finishedAt !== null &&
					observedAt - Date.parse(r.finishedAt) <= REPLAY_WINDOW_MS,
			);
			if (finished.length === 0) return;

			const names = new Map<string, string>();
			const hooks = await getData<{ id: string; name: string }>(
				endpoint,
				`/api/webhooks?_limit=${WEBHOOK_LIMIT}`,
			);
			for (const w of hooks.data) names.set(w.id, w.name);

			replays = finished.map((r) => ({
				replayId: r.replayId,
				webhookId: r.webhookId,
				webhookName: names.get(r.webhookId) ?? r.webhookId,
				finishedAt: r.finishedAt as string,
				delivered: r.delivered ?? 0,
				gaveUp: r.gaveUp ?? 0,
				total: r.total,
			}));
		} catch (err) {
			logger.warn("workload.push_watch.tenant_failed", {
				accountId: tenant.account_id,
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		await postPush(
			platform,
			{ accountId: tenant.account_id, replays },
			now(),
			doFetch,
		);
	}

	return async () => {
		let tenants: TenantRow[];
		try {
			tenants = await listTenants();
		} catch (err) {
			logger.warn("workload.push_watch.tenant_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		for (const tenant of tenants) await reportTenant(tenant);
	};
}
