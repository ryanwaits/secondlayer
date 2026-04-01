import type { QueueStats } from "@secondlayer/shared/types";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Streams } from "./streams/client.ts";
import { Subgraphs } from "./subgraphs/client.ts";

export class SecondLayer extends BaseClient {
	readonly streams: Streams;
	readonly subgraphs: Subgraphs;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.streams = new Streams(options);
		this.subgraphs = new Subgraphs(options);
	}

	async getQueueStats(): Promise<QueueStats> {
		const status = await this.request<{ queue: QueueStats }>("GET", "/status");
		return status.queue;
	}
}
