import type { Webhook, WebhookOutbox } from "@secondlayer/shared/db";

/**
 * CloudEvents 1.0 structured JSON — https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md
 *
 * Body shape:
 *   {
 *     "specversion": "1.0",
 *     "type":        "chain.<trigger>.apply",
 *     "source":      "secondlayer:<chain>",   // stacks | bitcoin
 *     "id":          <outbox.id>,        // UUID, used for dedup
 *     "time":        <ISO 8601>,
 *     "datacontenttype": "application/json",
 *     "data":        { ...event }
 *   }
 *
 * Content-Type is `application/cloudevents+json; charset=utf-8`. Binary
 * mode (headers as ce-*) isn't needed — structured mode is what every CE
 * SDK accepts out of the box.
 */

/** The chain that produced the event. Runes (Bitcoin) payloads carry
 *  `chain: "bitcoin"`; every other trigger matches Stacks events. */
function chainOf(payload: unknown): "stacks" | "bitcoin" {
	return (payload as { chain?: unknown } | null)?.chain === "bitcoin"
		? "bitcoin"
		: "stacks";
}

export function buildCloudEvents(
	outboxRow: WebhookOutbox,
	_sub: Webhook,
): { body: string; headers: Record<string, string> } {
	const event = {
		specversion: "1.0",
		type: outboxRow.event_type,
		source: `secondlayer:${chainOf(outboxRow.payload)}`,
		id: outboxRow.id,
		time: new Date(outboxRow.created_at).toISOString(),
		datacontenttype: "application/json",
		data: outboxRow.payload,
	};
	return {
		body: JSON.stringify(event),
		headers: {
			"content-type": "application/cloudevents+json; charset=utf-8",
		},
	};
}
