import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";

/**
 * Raw JSON — the row payload, nothing else. User controls Content-Type +
 * arbitrary headers via `sub.auth_config.headers`. Useful for targets that
 * already have their own wire contract (e.g. Zapier hooks, internal
 * services, Slack webhooks with raw-shaped bodies).
 *
 * Special-case: if `auth_config.authType === "basic"` and `basicAuth` is
 * set (`user:pass` base64 or plain user/pass object), emit a Basic header.
 * If `authType === "bearer"` with `token`/`tokenEnc`, emit a Bearer header.
 * Otherwise no auth is set — user URLs often include a token in the query
 * string (Slack) or an HMAC at the receiver (Zapier).
 */

export function buildRaw(
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
): { body: string; headers: Record<string, string> } {
	const cfg = sub.auth_config as {
		contentType?: string;
		headers?: Record<string, string>;
		authType?: "bearer" | "basic" | "none";
		token?: string;
		basicAuth?: string;
	};
	const headers: Record<string, string> = {
		"content-type": cfg.contentType ?? "application/json",
		...(cfg.headers ?? {}),
	};
	if (cfg.authType === "bearer" && cfg.token) {
		headers.authorization = `Bearer ${cfg.token}`;
	} else if (cfg.authType === "basic" && cfg.basicAuth) {
		headers.authorization = `Basic ${cfg.basicAuth}`;
	}
	return {
		body: JSON.stringify(outboxRow.payload),
		headers,
	};
}
