import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import type { SubscriptionOutbox } from "@secondlayer/shared/db";

/**
 * Build a Standard Webhooks POST body + headers for an outbox row.
 * https://standardwebhooks.com
 *
 * Body shape: `{ type, timestamp, data }`
 *   - `type` — `<subgraph>.<table>.<verb>` (e.g. `bitcoin.transfers.created`)
 *   - `timestamp` — ISO 8601 when the subgraph block was processed
 *   - `data` — the row payload (bigints already stringified by flush manifest)
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
	const payload: StandardWebhooksPayload = {
		type: outboxRow.event_type,
		timestamp: new Date(outboxRow.created_at).toISOString(),
		data: outboxRow.payload as Record<string, unknown>,
	};
	const body = JSON.stringify(payload);
	const sigHeaders = sign(body, signingSecret, {
		id: outboxRow.id,
		timestampSeconds: Math.floor(
			new Date(outboxRow.created_at).getTime() / 1000,
		),
	});
	return {
		body,
		headers: {
			"content-type": "application/json",
			...sigHeaders,
		},
	};
}
