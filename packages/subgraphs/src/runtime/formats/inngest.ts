import type { SubscriptionOutbox } from "@secondlayer/shared/db";

/**
 * Inngest event format — https://www.inngest.com/docs/events/sending-events
 *
 * POST body is a JSON array of one or more events. The Inngest event key
 * goes in the URL path (`https://inn.gs/e/{EVENT_KEY}`), so the user sets
 * that on `subscription.url` directly — no auth header needed.
 *
 * Body per event:
 *   - `name`      — event name (we use `<subgraph>.<table>.created` so it
 *                    matches Inngest fn `event` triggers out of the box)
 *   - `data`      — row payload
 *   - `id`        — dedupes on Inngest's side (mirrors outbox id)
 *   - `ts`        — unix millis when the event occurred
 *   - `v`         — version tag, fixed at `"2026-04-23.v1"` for forward compat
 */

export const INNGEST_VERSION = "2026-04-23.v1";

export function buildInngest(outboxRow: SubscriptionOutbox): {
	body: string;
	headers: Record<string, string>;
} {
	const event = {
		name: outboxRow.event_type,
		data: outboxRow.payload,
		id: outboxRow.id,
		ts: new Date(outboxRow.created_at).getTime(),
		v: INNGEST_VERSION,
	};
	return {
		body: JSON.stringify([event]),
		headers: {
			"content-type": "application/json",
		},
	};
}
