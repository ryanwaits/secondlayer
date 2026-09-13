import type { SecondLayer } from "@secondlayer/sdk";
import {
	type WebhookSchemaTables as SubscriptionSchemaTables,
	validateWebhookFilterForTable as validateSubscriptionFilterForTable,
} from "@secondlayer/shared/schemas/webhooks";

export async function validateSubscriptionTargetFromApi(
	client: SecondLayer,
	input: {
		subgraphName: string;
		tableName: string;
		filter?: Record<string, unknown>;
	},
): Promise<void> {
	const subgraph = await client.subgraphs.status(input.subgraphName);
	const errors = validateSubscriptionFilterForTable({
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
		tables: subgraph.tables as SubscriptionSchemaTables,
	});
	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}
}
