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

/**
 * Client-only fetchers for /account/webhooks, calling the dashboard's own
 * `/api/webhooks/*` proxy (never the platform API directly — same style as
 * `account-data.ts`). Every call maps the proxy's status code to one of a
 * few outcomes the UI actually branches on, instead of throwing: a starting
 * hosted stack and a zero balance are expected states here, not errors.
 */

/** One UTC day of delivery attempts, from `GET /:id/activity?days=30`. */
export type WebhookActivityDay = NonNullable<WebhookActivity["days"]>[number];

/** `GET /api/webhooks/activity`: 168 UTC hour starts, oldest first, and each
 *  webhook's delivered and failed counts aligned to them. The SDK has no
 *  method or type for this route yet, so the shape is declared here. */
export interface WebhooksActivitySummary {
	hours: string[];
	webhooks: Array<{ id: string; delivered: number[]; failed: number[] }>;
}

export type WebhooksResult<T> =
	| { kind: "ok"; data: T }
	| { kind: "starting"; retryAfter: number }
	/** The stack stopped while nothing used it; reads don't restart it. */
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "rate_limited"; retryAfter: number }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

/** Pure status → result-kind mapping. Returns `null` for a 2xx, meaning the
 *  caller should read the response body as the success payload. */
export function resultForStatus(
	status: number,
	retryAfterHeader: string | null,
	errorMessage: string,
): WebhooksResult<never> | null {
	if (status >= 200 && status < 300) return null;
	const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 30;
	if (status === 503 && errorMessage === "asleep") return { kind: "asleep" };
	if (status === 503) return { kind: "starting", retryAfter };
	if (status === 402) return { kind: "no_credits" };
	if (status === 429) return { kind: "rate_limited", retryAfter };
	if (status === 404) return { kind: "not_found" };
	return { kind: "error", message: errorMessage };
}

/** A tenant on an older API image can omit `blockTime` from a delivery row
 *  entirely (plan 064 fixes the auto-upgrade gap) — normalize that absence
 *  to `null`, same as a row that genuinely has none. */
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
	} catch {
		// Empty body on some error responses; fall through to the status-only message.
	}
	const errorMessage =
		body &&
		typeof body === "object" &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
			? (body as { error: string }).error
			: `Request failed (${res.status})`;
	const mapped = resultForStatus(
		res.status,
		res.headers.get("Retry-After"),
		errorMessage,
	);
	if (mapped) return mapped;
	return { kind: "ok", data: body as T };
}

async function requestList<T>(path: string): Promise<WebhooksResult<T[]>> {
	const res = await request<{ data: T[] }>(path);
	return res.kind === "ok" ? { kind: "ok", data: res.data.data } : res;
}

/** `wake` starts an asleep stack; without it a read leaves the stack asleep. */
export function listWebhooks(
	opts: { wake?: boolean } = {},
): Promise<WebhooksResult<WebhookSummary[]>> {
	return requestList<WebhookSummary>(opts.wake ? "?wake=1" : "");
}

export function getWebhook(id: string): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}`);
}

/** Deliveries, newest first. A `window` (ISO `from`/`to`, at most 31 days)
 *  narrows to one stretch, such as the hour a heat square stands for. */
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

/** One delivery with its payload, read when a dashboard row is opened. */
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

/** A week of hourly counts. `days: 30` adds 30 UTC days of daily counts. */
export function getActivity(
	id: string,
	opts?: { days?: 30 },
): Promise<WebhooksResult<WebhookActivity>> {
	const query = opts?.days ? `?days=${opts.days}` : "";
	return request<WebhookActivity>(
		`/${encodeURIComponent(id)}/activity${query}`,
	);
}

/** Hourly delivered and failed counts for every webhook, for the heat strips
 *  and sparklines. A 404 (no hosted stack yet) reads as no activity, like the
 *  list endpoint. */
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

/** Send one test event to the webhook's server; it is logged as a delivery. */
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

/** Replay a block range. A 409 (a scan is already running) comes back as an
 *  `error` carrying the API's text. */
export function startReplay(
	id: string,
	range: { fromBlock: number; toBlock: number },
): Promise<WebhooksResult<ReplayResult>> {
	return postJson<ReplayResult>(`/${encodeURIComponent(id)}/replay`, range);
}

/** A webhook's recent replays, plus the range presets and what gave up. */
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

/** Replays running now or started in the last 24 hours, across the account. */
export function getRecentReplays(): Promise<
	WebhooksResult<{ data: ReplayProgress[] }>
> {
	return request("/replays?_limit=20");
}

/** Requeue dead events: those of one replay, those since a time, or all. */
export function requeueDead(
	id: string,
	opts: { replayId?: string; since?: string },
): Promise<WebhooksResult<{ requeued: number }>> {
	return postJson(`/${encodeURIComponent(id)}/dead/requeue`, opts);
}

/** Rename a webhook. Only the label changes. A 409 (a Sentinel-managed name,
 *  or a name already in use) comes back as an `error` carrying the API's text. */
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

/** "12s ago" / "41m ago" / "3h ago" / "6d ago"; "never" for `null`. Coarsest
 *  unit only, matching the mock — nobody needs "3d 4h ago" on a list row. */
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

/** The host part of a webhook's target URL, for the list row sub-line. Falls
 *  back to a naive strip when the URL somehow doesn't parse (never should —
 *  the API validates it on create). */
export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
}
