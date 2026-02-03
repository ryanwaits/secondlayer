import type { ViewDefinition } from "./types.ts";

/**
 * Identity function that provides type inference for view definitions.
 *
 * @example
 * ```ts
 * export default defineView({
 *   name: "my-view",
 *   sources: [{ contract: "SP000...::my-contract" }],
 *   schema: { transfers: { columns: { amount: { type: "uint" } } } },
 *   handlers: { "*": (event, ctx) => { ... } }
 * })
 * ```
 */
export function defineView(def: ViewDefinition): ViewDefinition {
  return def;
}
