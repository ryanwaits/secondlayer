import type { QueueStats } from "@secondlayer/shared/types";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Streams } from "./streams/client.ts";
import { Views } from "./views/client.ts";

export class SecondLayer extends BaseClient {
  readonly streams: Streams;
  readonly views: Views;

  constructor(options: Partial<SecondLayerOptions> = {}) {
    super(options);
    this.streams = new Streams(options);
    this.views = new Views(options);
  }

  async getQueueStats(): Promise<QueueStats> {
    const status = await this.request<{ queue: QueueStats }>("GET", "/status");
    return status.queue;
  }
}
