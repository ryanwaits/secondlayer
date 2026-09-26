import type {
	DeadRow,
	DeliveryRow,
	RotateSecretResponse,
	WebhookActivity,
	WebhookDeliveryDetail,
	WebhookDetail,
	WebhookSummary,
	WebhookTestResult,
} from "@secondlayer/sdk";

/**
 * Client-only fetchers for /account/webhooks, calling the dashboard's own
 * `/api/webhooks/*` proxy (never the platform API directly — same style as
 * `account-data.ts`). Every call maps the proxy's status code to one of a
 * few outcomes the UI actually branches on, instead of throwing: a starting
 * delivery service and a zero balance are expected states here, not errors.
 */

export type WebhooksResult<T> =
	| { kind: "ok"; data: T }
	| { kind: "starting"; retryAfter: number }
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

export function listWebhooks(): Promise<WebhooksResult<WebhookSummary[]>> {
	return requestList<WebhookSummary>("");
}

export function getWebhook(id: string): Promise<WebhooksResult<WebhookDetail>> {
	return request<WebhookDetail>(`/${encodeURIComponent(id)}`);
}

export async function getDeliveries(
	id: string,
): Promise<WebhooksResult<DeliveryRow[]>> {
	const res = await requestList<DeliveryRow>(
		`/${encodeURIComponent(id)}/deliveries`,
	);
	return res.kind === "ok"
		? { kind: "ok", data: res.data.map(normalizeDeliveryRow) }
		: res;
}

export function getDead(id: string): Promise<WebhooksResult<DeadRow[]>> {
	return requestList<DeadRow>(`/${encodeURIComponent(id)}/dead`);
}

export function getActivity(
	id: string,
): Promise<WebhooksResult<WebhookActivity>> {
	return request<WebhookActivity>(`/${encodeURIComponent(id)}/activity`);
}

export function getDelivery(
	id: string,
	deliveryId: string,
): Promise<WebhooksResult<WebhookDeliveryDetail>> {
	return request<WebhookDeliveryDetail>(
		`/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}`,
	);
}

export function testWebhook(
	id: string,
): Promise<WebhooksResult<WebhookTestResult>> {
	return request<WebhookTestResult>(`/${encodeURIComponent(id)}/test`, {
		method: "POST",
	});
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

export function rotateSecret(
	id: string,
): Promise<WebhooksResult<RotateSecretResponse>> {
	return request<RotateSecretResponse>(
		`/${encodeURIComponent(id)}/rotate-secret`,
		{ method: "POST" },
	);
}

export function requeue(
	id: string,
	outboxId: string,
): Promise<WebhooksResult<{ ok: true }>> {
	return request<{ ok: true }>(
		`/${encodeURIComponent(id)}/dead/${encodeURIComponent(outboxId)}/requeue`,
		{ method: "POST" },
	);
}

export function deleteWebhook(
	id: string,
): Promise<WebhooksResult<{ ok: true }>> {
	return request<{ ok: true }>(`/${encodeURIComponent(id)}`, {
		method: "DELETE",
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

// ── List-page insight memory (plan 068) ─────────────────────────────
// Per-viewer, v1 only: a server-side insights table (054) replaces this.
// Every read/write is try/catch-wrapped — the list page works with no
// memory at all (private browsing, blocked storage) instead of crashing.

const TOAST_SHOWN_KEY = "sl.webhooks.toastShown";
const DISMISSED_KEY = "sl.webhooks.dismissed";

function insightKey(webhookId: string, code: string): string {
	return `${webhookId}:${code}`;
}

function readInsightSet(key: string): Set<string> {
	try {
		const raw = localStorage.getItem(key);
		return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
	} catch {
		return new Set();
	}
}

function addToInsightSet(key: string, member: string): void {
	try {
		const set = readInsightSet(key);
		set.add(member);
		localStorage.setItem(key, JSON.stringify([...set]));
	} catch {
		// localStorage unavailable — the page still works, it just re-shows
		// the toast/line next visit.
	}
}

/** Has this (webhook, rule) already shown its once-per-session toast? */
export function hasShownToast(webhookId: string, code: string): boolean {
	return readInsightSet(TOAST_SHOWN_KEY).has(insightKey(webhookId, code));
}

export function markToastShown(webhookId: string, code: string): void {
	addToInsightSet(TOAST_SHOWN_KEY, insightKey(webhookId, code));
}

/** Has this (webhook, rule) been dismissed from the list line? */
export function isInsightDismissed(webhookId: string, code: string): boolean {
	return readInsightSet(DISMISSED_KEY).has(insightKey(webhookId, code));
}

export function dismissInsight(webhookId: string, code: string): void {
	addToInsightSet(DISMISSED_KEY, insightKey(webhookId, code));
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
