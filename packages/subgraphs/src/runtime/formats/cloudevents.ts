import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";

/**
 * CloudEvents 1.0 structured JSON — https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md
 *
 * Body shape:
 *   {
 *     "specversion": "1.0",
 *     "type":        "<subgraph>.<table>.created",
 *     "source":      "secondlayer:<subgraph_name>",
 *     "id":          <outbox.id>,        // UUID, used for dedup
 *     "time":        <ISO 8601>,
 *     "datacontenttype": "application/json",
 *     "data":        { ...row }
 *   }
 *
 * Content-Type is `application/cloudevents+json; charset=utf-8`. Binary
 * mode (headers as ce-*) isn't needed — structured mode is what every CE
 * SDK accepts out of the box.
 */

export function buildCloudEvents(
	outboxRow: SubscriptionOutbox,
	_sub: Subscription,
): { body: string; headers: Record<string, string> } {
	const event = {
		specversion: "1.0",
		type: outboxRow.event_type,
		source: `secondlayer:${outboxRow.subgraph_name}`,
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
