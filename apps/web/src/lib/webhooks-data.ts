import type {
	DeadRow,
	DeliveryRow,
	WebhookActivity,
	WebhookDeliveryDetail,
	WebhookDetail,
	WebhookSummary,
	WebhookTestResult,
} from "@secondlayer/sdk";
import type {
	ReplayProgress,
	ReplayRanges,
	ReplayResult,
} from "@secondlayer/shared/schemas/webhooks";
import { type WebhooksResult, resultFromResponse } from "./dashboard-results";

export type WebhookActivityDay = WebhookActivity["days"][number];

export interface WebhooksActivitySummary {
	hours: string[];
	webhooks: Array<{ id: string; delivered: number[]; failed: number[] }>;
}

export function normalizeDeliveryRow(row: DeliveryRow): DeliveryRow {
	return { ...row, blockTime: row.blockTime ?? null };
}

async function request<T>(
	path: string,
	init?: RequestInit,
): Promise<WebhooksResult<T>> {
	let res: Response;
	try {
		res = await fetch(`/api/webhooks${path}`, init);
	} catch {
		return { kind: "error", message: "Couldn't reach the dashboard" };
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {}
	return resultFromResponse<T>(res, body);
}

async function requestList<T>(path: string): Promise<WebhooksResult<T[]>> {
	const res = await request<{ data: T[] }>(path);
	return res.kind === "ok" ? { kind: "ok", data: res.data.data } : res;
}

export function listWebhooks(
	opts: { wake?: boolean } = {},
): Promise<WebhooksResult<WebhookSummary[]>> {
	return requestList<WebhookSummary>(opts.wake ? "?wake=1" : "");
}

export function getWebhook(id: string): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}`);
}

export async function getDeliveries(
	id: string,
	window?: { from: string; to: string },
): Promise<WebhooksResult<DeliveryRow[]>> {
	const query = window
		? `?${new URLSearchParams({ from: window.from, to: window.to })}`
		: "";
	const res = await requestList<DeliveryRow>(
		`/${encodeURIComponent(id)}/deliveries${query}`,
	);
	return res.kind === "ok"
		? { kind: "ok", data: res.data.map(normalizeDeliveryRow) }
		: res;
}

export function getDelivery(
	id: string,
	deliveryId: string,
): Promise<WebhooksResult<WebhookDeliveryDetail>> {
	return request<WebhookDeliveryDetail>(
		`/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}`,
	);
}

export function getDead(id: string): Promise<WebhooksResult<DeadRow[]>> {
	return requestList<DeadRow>(`/${encodeURIComponent(id)}/dead`);
}

export function getActivity(
	id: string,
): Promise<WebhooksResult<WebhookActivity>> {
	return request<WebhookActivity>(`/${encodeURIComponent(id)}/activity`);
}

/** A 404 (no hosted stack yet) reads as no activity, like the list endpoint. */
export async function getActivitySummary(): Promise<
	WebhooksResult<WebhooksActivitySummary>
> {
	const res = await request<WebhooksActivitySummary>("/activity");
	return res.kind === "not_found"
		? { kind: "ok", data: { hours: [], webhooks: [] } }
		: res;
}

export function pauseWebhook(
	id: string,
): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}/pause`, {
		method: "POST",
	});
}

export function resumeWebhook(
	id: string,
): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}/resume`, {
		method: "POST",
	});
}

export function testWebhook(
	id: string,
): Promise<WebhooksResult<WebhookTestResult>> {
	return request<WebhookTestResult>(`/${encodeURIComponent(id)}/test`, {
		method: "POST",
	});
}

function postJson<T>(path: string, body: unknown): Promise<WebhooksResult<T>> {
	return request<T>(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

export function startReplay(
	id: string,
	range: { fromBlock: number; toBlock: number },
): Promise<WebhooksResult<ReplayResult>> {
	return postJson<ReplayResult>(`/${encodeURIComponent(id)}/replay`, range);
}

export function getReplays(
	id: string,
): Promise<WebhooksResult<{ data: ReplayProgress[]; ranges: ReplayRanges }>> {
	return request(`/${encodeURIComponent(id)}/replays`);
}

export function getReplay(
	id: string,
	replayId: string,
): Promise<WebhooksResult<ReplayProgress>> {
	return request<ReplayProgress>(
		`/${encodeURIComponent(id)}/replays/${encodeURIComponent(replayId)}`,
	);
}

export function getRecentReplays(): Promise<
	WebhooksResult<{ data: ReplayProgress[] }>
> {
	return request("/replays?_limit=20");
}

export function requeueDead(
	id: string,
	opts: { replayId?: string; since?: string },
): Promise<WebhooksResult<{ requeued: number }>> {
	return postJson(`/${encodeURIComponent(id)}/dead/requeue`, opts);
}

export function renameWebhook(
	id: string,
	name: string,
): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
}

export function formatRelative(
	iso: string | null,
	now: number = Date.now(),
): string {
	if (!iso) return "never";
	const ms = now - new Date(iso).getTime();
	if (!Number.isFinite(ms) || ms < 0) return "just now";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
}
