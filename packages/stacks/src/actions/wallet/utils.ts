import type { Account } from "../../clients/types.ts";
import type { ProviderAccount } from "../../accounts/types.ts";

export function isProviderAccount(account: Account): account is ProviderAccount {
  return account.type === "provider";
}
