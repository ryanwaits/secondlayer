import type { StacksChain } from "../chains/types.ts";
import type { TransportConfig, TransportFactory } from "./types.ts";
import { buildRequestFn, createTransport } from "./createTransport.ts";

/**
 * Create an HTTP transport for Stacks node RPC calls.
 * Falls back to the chain's default RPC URL, then `localhost:3999`.
 */
export function http(url?: string, config?: TransportConfig): TransportFactory {
  return (params) => {
    const resolvedUrl =
      url ?? params?.chain?.rpcUrls.default.http[0] ?? "http://localhost:3999";

    const mergedConfig: TransportConfig = {
      ...config,
      url: resolvedUrl,
    };

    return createTransport("http", {
      ...mergedConfig,
      request: buildRequestFn(resolvedUrl, mergedConfig),
    });
  };
}
