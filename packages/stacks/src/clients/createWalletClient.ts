import { createClient } from "./createClient.ts";
import { type WalletActions, walletActions } from "./decorators/wallet.ts";
import type { Account, Client, ClientConfig } from "./types.ts";

/** Configuration for {@link createWalletClient} — requires an account for signing. */
export type WalletClientConfig = ClientConfig & {
	account: Account;
};

/**
 * Create a client pre-extended with {@link WalletActions} for signing and broadcasting transactions.
 */
export function createWalletClient(
	config: WalletClientConfig,
): Client<WalletActions> & WalletActions & { account: Account } {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	return createClient(config).extend(walletActions) as any;
}
