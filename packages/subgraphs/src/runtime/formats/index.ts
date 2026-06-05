import { signSecondlayerWebhook } from "@secondlayer/shared/crypto/secondlayer-webhook";
import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { buildCloudEvents } from "./cloudevents.ts";
import { buildCloudflare } from "./cloudflare.ts";
import { buildInngest } from "./inngest.ts";
import { buildRaw } from "./raw.ts";
import { buildStandardWebhooks } from "./standard-webhooks.ts";
import { buildTrigger } from "./trigger.ts";

export interface FormatBuildResult {
	body: string;
	headers: Record<string, string>;
}

function buildBody(
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
	signingSecret: string,
): FormatBuildResult {
	switch (sub.format) {
		case "inngest":
			return buildInngest(outboxRow);
		case "trigger":
			return buildTrigger(outboxRow, sub);
		case "cloudflare":
			return buildCloudflare(outboxRow, sub);
		case "cloudevents":
			return buildCloudEvents(outboxRow, sub);
		case "raw":
			return buildRaw(outboxRow, sub);
		case "standard-webhooks":
			return buildStandardWebhooks(outboxRow, signingSecret);
		default:
			logger.warn(
				"Unknown subscription format, falling back to standard-webhooks",
				{
					format: sub.format,
					subscriptionId: sub.id,
				},
			);
			return buildStandardWebhooks(outboxRow, signingSecret);
	}
}

/**
 * Dispatch an outbox row through the format matching the subscription's
 * `format` column. Unknown formats fall back to `standard-webhooks` with
 * a warning log — receivers always get something deliverable.
 *
 * Every delivery, whatever its body shape, also gets the universal Secondlayer
 * authenticity headers (`webhook-id` + `X-Secondlayer-Signature`) so a receiver
 * can prove the payload came from us with one published public key — not just
 * the `standard-webhooks` format. The signature covers the exact body bytes
 * built here, so it must be attached after the body is final.
 */
export function buildForFormat(
	outboxRow: SubscriptionOutbox,
	sub: Subscription,
	signingSecret: string,
): FormatBuildResult {
	const result = buildBody(outboxRow, sub, signingSecret);
	const sigHeaders = signSecondlayerWebhook(outboxRow.id, result.body);
	if (sigHeaders) {
		result.headers = { ...result.headers, ...sigHeaders };
	}
	return result;
}

export {
	buildStandardWebhooks,
	buildInngest,
	buildTrigger,
	buildCloudflare,
	buildCloudEvents,
	buildRaw,
};
