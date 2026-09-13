import type { SecondLayer } from "@secondlayer/sdk";
import {
	type WebhookSchemaTables,
	validateWebhookFilterForTable,
} from "@secondlayer/shared/schemas/webhooks";

export async function validateWebhookTargetFromApi(
	client: SecondLayer,
	input: {
		subgraphName: string;
		tableName: string;
		filter?: Record<string, unknown>;
	},
): Promise<void> {
	const subgraph = await client.subgraphs.status(input.subgraphName);
	const errors = validateWebhookFilterForTable({
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
		tables: subgraph.tables as WebhookSchemaTables,
	});
	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}
}
