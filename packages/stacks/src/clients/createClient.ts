import type { Client, ClientConfig } from "./types.ts";

const BASE_KEYS = new Set(["chain", "account", "transport", "request", "extend"]);

/**
 * Create a base client with transport and optional chain/account.
 * Use `.extend()` to compose action decorators (public, wallet, multisig).
 */
export function createClient<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
>(config: ClientConfig): Client<TExtended> {
  const transport = config.transport({ chain: config.chain });

  const client: Client = {
    chain: config.chain,
    account: config.account,
    transport,
    request: transport.request,
    extend(fn) {
      const extensions = fn(client);
      const extended = { ...client };

      for (const [key, value] of Object.entries(extensions)) {
        if (BASE_KEYS.has(key)) continue; // protect base properties
        (extended as any)[key] = value;
      }

      // re-bind extend so it chains
      extended.extend = (nextFn: any) => {
        const nextExtensions = nextFn(extended);
        const next = { ...extended };
        for (const [key, value] of Object.entries(nextExtensions)) {
          if (BASE_KEYS.has(key)) continue;
          (next as any)[key] = value;
        }
        next.extend = extended.extend;
        return next as any;
      };

      return extended as any;
    },
  };

  return client as Client<TExtended>;
}
