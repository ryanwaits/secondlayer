import type { StacksChain } from "./types.ts";

/** Identity helper for defining a custom {@link StacksChain} with full type inference. */
export function defineChain(chain: StacksChain): StacksChain {
  return chain;
}
