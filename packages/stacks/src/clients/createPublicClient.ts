import type { ClientConfig, Client } from "./types.ts";
import { createClient } from "./createClient.ts";
import { publicActions, type PublicActions } from "./decorators/public.ts";

/** Configuration for {@link createPublicClient} (no account needed). */
export type PublicClientConfig = Omit<ClientConfig, "account">;

/**
 * Create a read-only client pre-extended with {@link PublicActions}.
 * Use for queries, contract reads, and event subscriptions.
 */
export function createPublicClient(
  config: PublicClientConfig
): Client<PublicActions> & PublicActions {
  return createClient(config).extend(publicActions);
}
