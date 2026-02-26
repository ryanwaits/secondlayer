import type { ViewDefinition, ViewSchema } from "./types.ts";

/**
 * Identity function that preserves schema literal types for type inference.
 *
 * The generic `S` is narrowed to the exact schema shape so that column type
 * literals (e.g. `"uint"`) are preserved rather than widened to `string`.
 *
 * @example
 * ```ts
 * export default defineView({
 *   name: "my-view",
 *   sources: [{ contract: "SP000...::my-contract" }],
 *   schema: { transfers: { columns: { amount: { type: "uint" } } } },
 *   handlers: { "*": (event, ctx) => { ... } }
 * })
 * // typeof result.schema.transfers.columns.amount.type → "uint" (not string)
 * ```
 */
export function defineView<S extends ViewSchema>(
  def: Omit<ViewDefinition, "schema"> & { schema: S },
): Omit<ViewDefinition, "schema"> & { schema: S } {
  return def;
}
