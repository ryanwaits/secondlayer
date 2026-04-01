import { createClient } from "./createClient.ts";
import { type PublicActions, publicActions } from "./decorators/public.ts";
import type { Client, ClientConfig } from "./types.ts";

/** Configuration for {@link createPublicClient} (no account needed). */
export type PublicClientConfig = Omit<ClientConfig, "account">;

/**
 * Create a read-only client pre-extended with {@link PublicActions}.
 * Use for queries, contract reads, and event subscriptions.
 */
export function createPublicClient(
	config: PublicClientConfig,
): Client<PublicActions> & PublicActions {
	return createClient(config).extend(publicActions);
}
