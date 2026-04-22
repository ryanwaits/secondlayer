import type { SlackMessage } from "./types.ts";

const TIMEOUT_MS = 5_000;

export interface DeliveryResult {
	ok: boolean;
	status: number;
	error?: string;
}

async function postOnce(
	url: string,
	message: SlackMessage,
): Promise<DeliveryResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(message),
			signal: controller.signal,
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			return {
				ok: false,
				status: res.status,
				error: `${res.status}: ${body.slice(0, 200)}`,
			};
		}
		return { ok: true, status: res.status };
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "unknown delivery error";
		return { ok: false, status: 0, error: message };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Deliver a Slack-shape webhook payload. Retries once on network error or
 * 5xx; no retry on 4xx. No DLQ — caller persists delivery_status.
 */
export async function postToWebhook(
	url: string,
	message: SlackMessage,
): Promise<DeliveryResult> {
	const first = await postOnce(url, message);
	if (first.ok) return first;
	const transient = first.status === 0 || first.status >= 500;
	if (!transient) return first;
	return await postOnce(url, message);
}
