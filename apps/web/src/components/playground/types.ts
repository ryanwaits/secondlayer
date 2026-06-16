/**
 * Config-driven playground. Describe an endpoint, its editable inputs, and the
 * next-step CTA; <Playground> renders a live, keyless request cell from it.
 *
 * Design goal: adding a new playground is one config object, never new JSX.
 * Swapping the endpoint, pointing at a different contract, or adding a param
 * is an edit to `request.path` / `request.fields` — nothing else moves.
 */

export type FieldValue = string | number;
export type FieldValues = Record<string, FieldValue>;

/** Where a field's value lands in the request: a `{name}` path slot, or a
 *  query param keyed by the field name. */
type FieldTarget = "query" | "path";

interface FieldBase {
	/** Doubles as the query-param key and the `{name}` path-template slot. */
	name: string;
	label: string;
	into: FieldTarget;
	hint?: string;
}

/**
 * A `contract` is a text field today; the kind is kept distinct so a Stacks
 * contract-id picker/validator can attach later without touching configs.
 */
export type PlaygroundField =
	| (FieldBase & {
			kind: "enum";
			default: string;
			options: { value: string; label?: string }[];
	  })
	| (FieldBase & {
			kind: "text" | "contract" | "cursor";
			default: string;
			placeholder?: string;
	  })
	| (FieldBase & {
			kind: "number";
			into: "query";
			default: number;
			min?: number;
			max?: number;
			step?: number;
	  });

export type RenderMode = "json" | "ticker";

/**
 * What "going further" creates. Streams/Index are roll-your-own reads, so the
 * step up is an API key (lifts limits, works in your code). Subgraphs and
 * Subscriptions are real resources, so the step up is claiming/forking the
 * thing you just built into a fresh account.
 */
export type PlaygroundPayoff =
	| { kind: "apiKey"; blurb: string }
	| {
			kind: "claim";
			resource: "subgraph" | "subscription";
			cta: string;
			success: string;
			scaffold?: string;
	  };

export interface PlaygroundConfig {
	id: string;
	product: "streams" | "index" | "subgraphs" | "subscriptions";
	request: {
		/** Defaults to the public API base. */
		base?: string;
		/** Template with `{name}` slots filled by path-target fields. */
		path: string;
		fields: PlaygroundField[];
		/** `rest` fires a fetch on Send; `sse` opens an EventSource ticker. */
		mode: "rest" | "sse";
	};
	render: RenderMode;
	/** One-click named field-value sets — "preloaded queries" as chips. */
	presets?: { label: string; values: FieldValues }[];
	/** Agent-readable companions for the same endpoint. */
	agents?: Partial<
		Record<"markdown" | "openapi" | "schema" | "stream", string>
	>;
	payoff: PlaygroundPayoff;
}

export const PUBLIC_API_BASE = "https://api.secondlayer.tools";
