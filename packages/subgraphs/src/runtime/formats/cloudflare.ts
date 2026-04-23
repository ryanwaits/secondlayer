import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";
import { decryptSecret } from "@secondlayer/shared/crypto/secrets";

/**
 * Cloudflare Workflows — https://developers.cloudflare.com/workflows/build/events-and-parameters/
 *
 * POST https://api.cloudflare.com/client/v4/accounts/{account}/workflows/{name}/instances
 * Authorization: Bearer <CF_API_TOKEN>
 *
 * Body: `{ params }` — the workflow entrypoint receives this as the
 * `event.payload` object. We slip the outbox id into `params._subscriptionId`
 * so Workflows can dedupe on replays.
 */

function resolveBearer(sub: Subscription): string | null {
	const cfg = sub.auth_config as { token?: string; tokenEnc?: string };
	if (cfg.tokenEnc) {
		// Let decrypt errors propagate — see trigger.ts comment.
		return decryptSecret(Buffer.from(cfg.tokenEnc, "base64"));
	}
	return cfg.token ?? null;
}

export function buildCloudflare(
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
): { body: string; headers: Record<string, string> } {
	const body = JSON.stringify({
		params: {
			...(outboxRow.payload as Record<string, unknown>),
			_type: outboxRow.event_type,
			_outboxId: outboxRow.id,
		},
	});
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	const token = resolveBearer(sub);
	if (token) headers.authorization = `Bearer ${token}`;
	return { body, headers };
}
