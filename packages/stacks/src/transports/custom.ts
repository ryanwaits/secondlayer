import type { RequestFn, TransportFactory } from "./types.ts";
import { createTransport } from "./createTransport.ts";

/** Create a transport backed by a user-provided request function. */
export function custom(params: { request: RequestFn }): TransportFactory {
  return () => createTransport("custom", { request: params.request });
}
