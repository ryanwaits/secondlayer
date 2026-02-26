import type { InferViewClient } from "@secondlayer/views";
import type { SecondLayerOptions } from "../base.ts";
import { SecondLayer } from "../client.ts";
import { Views } from "./client.ts";

/**
 * Returns a typed client for a view defined with `defineView()`.
 *
 * Accepts a plain options object, a `SecondLayer` instance, or a `Views` instance.
 *
 * @example
 * ```ts
 * import myView from './views/my-view'
 * import { getView } from '@secondlayer/sdk'
 *
 * const client = getView(myView, { apiKey: 'sl_...' })
 * const rows = await client.transfers.findMany({ where: { sender: 'SP...' } })
 * ```
 */
export function getView<T extends { name: string; schema: Record<string, unknown> }>(
  def: T,
  options: Partial<SecondLayerOptions> | SecondLayer | Views = {},
): InferViewClient<T> {
  if (options instanceof Views) {
    return options.typed(def);
  }
  if (options instanceof SecondLayer) {
    return options.views.typed(def);
  }
  return new Views(options).typed(def);
}
