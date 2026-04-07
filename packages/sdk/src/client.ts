import type { QueueStats } from "@secondlayer/shared/types";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Marketplace } from "./marketplace/client.ts";
import { Streams } from "./streams/client.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import { Workflows } from "./workflows/client.ts";

export class SecondLayer extends BaseClient {
	readonly streams: Streams;
	readonly subgraphs: Subgraphs;
	readonly marketplace: Marketplace;
	readonly workflows: Workflows;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.streams = new Streams(options);
		this.subgraphs = new Subgraphs(options);
		this.marketplace = new Marketplace(options);
		this.workflows = new Workflows(options);
	}

	async getQueueStats(): Promise<QueueStats> {
		const status = await this.request<{ queue: QueueStats }>("GET", "/status");
		return status.queue;
	}
}
