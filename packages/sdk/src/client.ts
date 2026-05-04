import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Index } from "./index-api/client.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import { Subscriptions } from "./subscriptions/client.ts";

export class SecondLayer extends BaseClient {
	readonly index: Index;
	readonly subgraphs: Subgraphs;
	readonly subscriptions: Subscriptions;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.index = new Index(options);
		this.subgraphs = new Subgraphs(options);
		this.subscriptions = new Subscriptions(options);
	}
}
