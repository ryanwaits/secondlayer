import type { ClientConfig, Client, Account } from "./types.ts";
import { createClient } from "./createClient.ts";
import { walletActions, type WalletActions } from "./decorators/wallet.ts";

/** Configuration for {@link createWalletClient} — requires an account for signing. */
export type WalletClientConfig = ClientConfig & {
  account: Account;
};

/**
 * Create a client pre-extended with {@link WalletActions} for signing and broadcasting transactions.
 */
export function createWalletClient(
  config: WalletClientConfig
): Client<WalletActions> & WalletActions & { account: Account } {
  return createClient(config).extend(walletActions) as any;
}
