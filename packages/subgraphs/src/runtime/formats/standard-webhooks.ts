import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import type { SubscriptionOutbox } from "@secondlayer/shared/db";

/**
 * Build a Standard Webhooks POST body + headers for an outbox row.
 * https://standardwebhooks.com
 *
 * Body shape: `{ type, timestamp, data }`
 *   - `type` — `<subgraph>.<table>.<verb>` (e.g. `bitcoin.transfers.created`)
 *   - `timestamp` — ISO 8601 at DISPATCH time (not row creation). Receivers
 *     verify `webhook-timestamp` against a tolerance window (default 300s per
 *     Svix); stamping at creation would fail verification on every retry
 *     beyond the first, since retries fire up to 72h after the row was
 *     written. The `webhook-id` header stays stable across retries for
 *     receiver dedup.
 *   - `data` — row payload (bigints already stringified by flush manifest).
 *
 * Headers: the three standardwebhooks.com headers + Content-Type.
 */

export interface StandardWebhooksPayload {
	type: string;
	timestamp: string;
	data: Record<string, unknown>;
}

export function buildStandardWebhooks(
	outboxRow: SubscriptionOutbox,
	signingSecret: string,
): { body: string; headers: Record<string, string> } {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload: StandardWebhooksPayload = {
		type: outboxRow.event_type,
		timestamp: new Date(nowSeconds * 1000).toISOString(),
		data: outboxRow.payload as Record<string, unknown>,
	};
	const body = JSON.stringify(payload);
	const sigHeaders = sign(body, signingSecret, {
		id: outboxRow.id,
		timestampSeconds: nowSeconds,
	});
	return {
		body,
		headers: {
			"content-type": "application/json",
			...sigHeaders,
		},
	};
}
