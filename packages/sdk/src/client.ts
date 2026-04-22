import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Subgraphs } from "./subgraphs/client.ts";

export class SecondLayer extends BaseClient {
	readonly subgraphs: Subgraphs;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.subgraphs = new Subgraphs(options);
	}
}
