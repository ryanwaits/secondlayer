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
