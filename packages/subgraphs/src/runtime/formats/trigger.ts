import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";
import { decryptSecret } from "@secondlayer/shared/crypto/secrets";

/**
 * Trigger.dev v3 task trigger — https://trigger.dev/docs/tasks/overview
 *
 * POST https://api.trigger.dev/api/v1/tasks/{taskId}/trigger
 * Authorization: Bearer <TRIGGER_SECRET_KEY>
 *
 * Body:
 *   - `payload` — the row payload
 *   - `options` — currently `{ idempotencyKey }` so Trigger dedupes replays
 *
 * The Trigger secret lives in `sub.auth_config.tokenEnc` (encrypted by
 * `crypto/secrets`) or `sub.auth_config.token` (plaintext, dev only).
 */

function resolveBearer(sub: Subscription): string | null {
	const cfg = sub.auth_config as {
		authType?: string;
		token?: string;
		tokenEnc?: string;
	};
	if (cfg.tokenEnc) {
		try {
			return decryptSecret(Buffer.from(cfg.tokenEnc, "base64"));
		} catch {
			return null;
		}
	}
	return cfg.token ?? null;
}

export function buildTrigger(
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
): { body: string; headers: Record<string, string> } {
	const body = JSON.stringify({
		payload: outboxRow.payload,
		options: {
			idempotencyKey: outboxRow.id,
		},
	});
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	const token = resolveBearer(sub);
	if (token) headers.authorization = `Bearer ${token}`;
	return { body, headers };
}
