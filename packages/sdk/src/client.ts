import { ApiKeys } from "./api-keys/client.ts";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Contracts } from "./contracts/client.ts";
import { Datasets } from "./datasets/client.ts";
import { Index } from "./index-api/client.ts";
import { createStreamsClient } from "./streams/client.ts";
import type { StreamsClient } from "./streams/types.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import { Subscriptions } from "./subscriptions/client.ts";

export class SecondLayer extends BaseClient {
	readonly streams: StreamsClient;
	readonly index: Index;
	readonly datasets: Datasets;
	readonly contracts: Contracts;
	readonly subgraphs: Subgraphs;
	readonly subscriptions: Subscriptions;
	readonly apiKeys: ApiKeys;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.streams = createStreamsClient({
			apiKey: options.apiKey ?? "",
			baseUrl: options.baseUrl,
			fetchImpl: options.fetchImpl,
		});
		this.index = new Index(options);
		this.datasets = new Datasets(options);
		this.contracts = new Contracts(options);
		this.subgraphs = new Subgraphs(options);
		this.subscriptions = new Subscriptions(options);
		this.apiKeys = new ApiKeys(options);
	}
}
