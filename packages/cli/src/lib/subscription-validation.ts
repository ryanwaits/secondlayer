import type { SecondLayer } from "@secondlayer/sdk";
import {
	type SubscriptionSchemaTables,
	validateSubscriptionFilterForTable,
} from "@secondlayer/shared/schemas/subscriptions";

export async function validateSubscriptionTargetFromApi(
	client: SecondLayer,
	input: {
		subgraphName: string;
		tableName: string;
		filter?: Record<string, unknown>;
	},
): Promise<void> {
	const subgraph = await client.subgraphs.get(input.subgraphName);
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
