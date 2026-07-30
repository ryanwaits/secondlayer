import type { AnyEvent, EventForFilter } from "./events.ts";
import type { TypedSubgraphContext } from "./infer.ts";
import type {
	SubgraphDefinition,
	SubgraphFilter,
	SubgraphSchema,
} from "./types.ts";

/**
 * Handlers keyed by source name. Each handler's `event` is typed from the
 * matching source's filter `type` (e.g. a `print_event` source → `event.topic`
 * is a `string`), and `ctx` is typed against the subgraph `schema` (table
 * names + row columns checked). The optional `"*"` catch-all receives any event.
 *
 * Handlers are optional per source (a source with no handler is skipped at
 * runtime), matching `handlers[name] ?? handlers["*"]` resolution.
 */
export type TypedHandlers<
	Sources extends Record<string, SubgraphFilter>,
	S extends SubgraphSchema,
> = {
	[K in keyof Sources]?: (
		event: EventForFilter<Sources[K]>,
		ctx: TypedSubgraphContext<S>,
	) => void | Promise<void>;
} & {
	"*"?: (event: AnyEvent, ctx: TypedSubgraphContext<S>) => void | Promise<void>;
};

/** Subgraph definition with `sources`/`schema` literals preserved for typed
 * handlers and downstream query-client inference (`getSubgraph`). */
export type TypedSubgraphDefinition<
	Sources extends Record<string, SubgraphFilter>,
	S extends SubgraphSchema,
> = Omit<SubgraphDefinition, "sources" | "schema" | "handlers"> & {
	sources: Sources;
	schema: S;
	handlers: TypedHandlers<Sources, S>;
};

/**
 * Identity function that preserves `sources` and `schema` literal types so
 * handlers are typed per source and the schema drives query-client inference.
 *
 * @example
 * ```ts
 * export default defineSubgraph({
 *   name: "my-subgraph",
 *   sources: { transfer: { type: "ft_transfer", assetIdentifier: "SP...::token" } },
 *   schema: { transfers: { columns: { amount: { type: "uint" } } } },
 *   handlers: {
 *     transfer: (event, ctx) => {
 *       // event: FtTransferPayload → event.amount is bigint, no cast
 *       ctx.insert("transfers", { amount: event.amount });
 *     },
 *   },
 * });
 * ```
 */
export function defineSubgraph<
	const Sources extends Record<string, SubgraphFilter>,
	const S extends SubgraphSchema,
>(
	def: TypedSubgraphDefinition<Sources, S>,
): TypedSubgraphDefinition<Sources, S> {
	return def;
}

/**
 * Identity helper that preserves a schema literal's exact types so it can be
 * HOISTED out of the `defineSubgraph()` call and reused:
 *
 * ```ts
 * export const schema = defineSchema({
 *   balances: {
 *     columns: { holder: { type: "principal" }, amount: { type: "uint" } },
 *     uniqueKeys: [["holder"]],
 *   },
 * });
 *
 * // An extracted helper keeps the full typed surface — table names and row
 * // columns are still checked:
 * function credit(ctx: TypedSubgraphContext<typeof schema>, holder: string) {
 *   ctx.increment("balances", { holder }, { amount: 1n });
 * }
 *
 * export default defineSubgraph({ name: "balances", schema, sources, handlers });
 * ```
 *
 * `as const` alone does not work here (it produces `readonly` arrays that a
 * mutable `uniqueKeys` rejected) and a bare literal widens `type` to `string`.
 * That gap is why the shipped starter typed its helper `ctx: any` — and in
 * doing so modelled a non-commutative read-modify-write the docs warn against.
 */
export function defineSchema<const S extends SubgraphSchema>(schema: S): S {
	return schema;
}

/**
 * The typed handler context for a subgraph definition — for annotating
 * helpers extracted out of a handler:
 *
 * ```ts
 * const def = defineSubgraph({ … });
 * function credit(ctx: InferContext<typeof def>) { … }
 * ```
 *
 * Prefer `TypedSubgraphContext<typeof schema>` when the schema is hoisted;
 * this is the form for when only the definition is in scope.
 */
export type InferContext<D> = D extends {
	schema: infer S extends SubgraphSchema;
}
	? TypedSubgraphContext<S>
	: never;
