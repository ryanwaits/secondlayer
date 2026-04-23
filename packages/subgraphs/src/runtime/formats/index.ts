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

/**
 * Dispatch an outbox row through the format matching the subscription's
 * `format` column. Unknown formats fall back to `standard-webhooks` with
 * a warning log — receivers always get something deliverable.
 */
export function buildForFormat(
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
			logger.warn("Unknown subscription format, falling back to standard-webhooks", {
				format: sub.format,
				subscriptionId: sub.id,
			});
			return buildStandardWebhooks(outboxRow, signingSecret);
	}
}

export {
	buildStandardWebhooks,
	buildInngest,
	buildTrigger,
	buildCloudflare,
	buildCloudEvents,
	buildRaw,
};
