import type { InferSubgraphClient } from "@secondlayer/subgraphs";
import type { SecondLayerOptions } from "../base.ts";
import { SecondLayer } from "../client.ts";
import { Subgraphs } from "./client.ts";

/**
 * Returns a typed client for a subgraph defined with `defineSubgraph()`.
 *
 * Accepts a plain options object, a `SecondLayer` instance, or a `Subgraphs` instance.
 *
 * @example
 * ```ts
 * import mySubgraph from './subgraphs/my-subgraph'
 * import { getSubgraph } from '@secondlayer/sdk'
 *
 * const client = getSubgraph(mySubgraph, { apiKey: 'sl_...' })
 * const rows = await client.transfers.findMany({ where: { sender: 'SP...' } })
 * ```
 */
export function getSubgraph<
	T extends { name: string; schema: Record<string, unknown> },
>(
	def: T,
	options: Partial<SecondLayerOptions> | SecondLayer | Subgraphs = {},
): InferSubgraphClient<T> {
	if (options instanceof Subgraphs) {
		return options.typed(def);
	}
	if (options instanceof SecondLayer) {
		return options.subgraphs.typed(def);
	}
	return new Subgraphs(options).typed(def);
}
