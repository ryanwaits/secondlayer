import type { SubgraphDefinition, SubgraphSchema } from "./types.ts";

/**
 * Identity function that preserves schema literal types for type inference.
 *
 * The generic `S` is narrowed to the exact schema shape so that column type
 * literals (e.g. `"uint"`) are preserved rather than widened to `string`.
 *
 * @example
 * ```ts
 * export default defineSubgraph({
 *   name: "my-subgraph",
 *   sources: { transfer: { type: "ft_transfer", assetIdentifier: "SP...::token" } },
 *   schema: { transfers: { columns: { amount: { type: "uint" } } } },
 *   handlers: { transfer: (event, ctx) => { ... } }
 * })
 * ```
 */
export function defineSubgraph<S extends SubgraphSchema>(
	def: Omit<SubgraphDefinition, "schema"> & { schema: S },
): Omit<SubgraphDefinition, "schema"> & { schema: S } {
	return def;
}
