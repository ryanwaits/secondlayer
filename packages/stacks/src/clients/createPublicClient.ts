import type { ClientConfig, Client } from "./types.ts";
import { createClient } from "./createClient.ts";
import { publicActions, type PublicActions } from "./decorators/public.ts";

export type PublicClientConfig = Omit<ClientConfig, "account">;

export function createPublicClient(
  config: PublicClientConfig
): Client<PublicActions> & PublicActions {
  return createClient(config).extend(publicActions);
}
