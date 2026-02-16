import type { Client, ClientConfig } from "./types.ts";

const BASE_KEYS = new Set(["chain", "account", "transport", "request", "extend"]);

function bindExtend(base: Client): Client["extend"] {
  return ((fn: any) => {
    const extensions = fn(base);
    const next = { ...base };
    for (const [key, value] of Object.entries(extensions)) {
      if (BASE_KEYS.has(key)) continue;
      (next as any)[key] = value;
    }
    next.extend = bindExtend(next);
    return next as any;
  }) as Client["extend"];
}

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
    extend: null as any,
  };

  client.extend = bindExtend(client);

  return client as Client<TExtended>;
}
