import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import { Workflows } from "./workflows/client.ts";

export class SecondLayer extends BaseClient {
	readonly subgraphs: Subgraphs;
	readonly workflows: Workflows;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.subgraphs = new Subgraphs(options);
		this.workflows = new Workflows(options);
	}
}
