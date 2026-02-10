import type { TransportFactory } from "./types.ts";
import { createTransport } from "./createTransport.ts";

/** Create a transport that tries each transport in order until one succeeds. */
export function fallback(transports: TransportFactory[]): TransportFactory {
  return (params) => {
    const resolved = transports.map((t) => t(params));

    return createTransport("fallback", {
      request: async (path, options) => {
        let lastError: Error | undefined;
        for (const transport of resolved) {
          try {
            return await transport.request(path, options);
          } catch (error) {
            lastError =
              error instanceof Error ? error : new Error(String(error));
          }
        }
        throw lastError ?? new Error("All transports failed");
      },
    });
  };
}
