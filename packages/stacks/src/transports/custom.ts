import type { RequestFn, TransportFactory } from "./types.ts";
import { createTransport } from "./createTransport.ts";

export function custom(params: { request: RequestFn }): TransportFactory {
  return () => createTransport("custom", { request: params.request });
}
