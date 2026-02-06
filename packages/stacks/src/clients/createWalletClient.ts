import type { ClientConfig, Client, Account } from "./types.ts";
import { createClient } from "./createClient.ts";
import { walletActions, type WalletActions } from "./decorators/wallet.ts";

export type WalletClientConfig = ClientConfig & {
  account: Account;
};

export function createWalletClient(
  config: WalletClientConfig
): Client<WalletActions> & WalletActions & { account: Account } {
  return createClient(config).extend(walletActions) as any;
}
