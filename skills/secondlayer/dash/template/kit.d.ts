// Types for kit.js, so check.ts (and tests) import it with full checking.

export type Network = "mainnet" | "testnet" | "devnet";

export interface PropDef {
	type: "string" | "string[]" | "number" | "network" | "network[]" | "month";
	required?: boolean;
	enum?: Array<number | string>;
	min?: number;
	max?: number;
	default?: unknown;
}

export interface ComponentDef {
	/** Set on views a row opens (Payload, RowPanel); a spec never places them. */
	openedFrom?: string;
	children?: boolean;
	networks?: Network[];
	props: Record<string, PropDef>;
	reads: string[];
	poll: number | null;
}

export interface Catalog {
	version: 1;
	networks: Network[];
	components: Record<string, ComponentDef>;
}

export interface SpecElement {
	type: string;
	props?: Record<string, unknown>;
	children?: string[];
}

export interface Spec {
	version: 1;
	root: string;
	state?: Record<string, unknown>;
	elements: Record<string, SpecElement>;
}

export interface SpecError {
	id: string | null;
	prop: string | null;
	message: string;
}

export interface ProbeNetwork {
	ok: boolean;
	reason?: string;
	webhooks?: unknown[];
	subgraphs?: unknown[];
}

export interface Decision {
	networks: Network[];
	tabs: boolean;
}

export interface CatalogEntry {
	render?: (input: unknown) => unknown;
	prompt: (props: Record<string, unknown>, data: unknown) => string[];
	reads: (props: Record<string, unknown>, data: unknown) => string[];
}

export declare const CATALOG: Record<string, CatalogEntry>;

export declare function validateSpec(
	spec: unknown,
	catalog: Catalog,
): SpecError[];

export declare function decideNetworks(input: {
	named?: string | string[] | null;
	probe?: { networks?: Partial<Record<Network, ProbeNetwork>> } | null;
	resource?: "webhooks" | "subgraphs";
}): Decision;

export interface PromptState {
	/** The network the page shows now (the selected tab, or the spec's). */
	network?: Network;
	/** The networks NetworkTabs shows; more than one means a tab bar. */
	networks?: Network[];
	/** The selected label index of each Tabs element, by element id. */
	tabs?: Record<string, number>;
	/** The open delivery or row, with the data its view shows. */
	open?: {
		type: "Payload" | "RowPanel";
		/** The element it opened from; while that isn't shown, it's left out. */
		from?: string;
		data: unknown;
	} | null;
	bases?: Partial<Record<Network, string>>;
	at: string | Date;
}

export declare function buildPrompt(
	spec: Spec,
	state: PromptState,
	data: Record<string, unknown>,
): string;

export declare function render(
	spec: Spec,
	root: Element,
	options: {
		catalog: Catalog;
		fetch?: (input: string, init?: RequestInit) => Promise<Response>;
		now?: () => Date;
		api?: string;
		/** Shown in the bar. A loopback host hides the public-URL notice. */
		host?: string;
	},
): () => void;
