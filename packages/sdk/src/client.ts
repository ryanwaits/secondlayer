import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Sentries } from "./sentries/client.ts";
import { Subgraphs } from "./subgraphs/client.ts";

export class SecondLayer extends BaseClient {
	readonly subgraphs: Subgraphs;
	readonly sentries: Sentries;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.subgraphs = new Subgraphs(options);
		this.sentries = new Sentries(options);
	}
}
