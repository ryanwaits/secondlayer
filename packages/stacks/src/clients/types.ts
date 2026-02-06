import type { StacksChain } from "../chains/types.ts";
import type { Transport, TransportFactory, RequestFn } from "../transports/types.ts";
import type { LocalAccount, CustomAccount, ProviderAccount } from "../accounts/types.ts";

export type Account = LocalAccount | CustomAccount | ProviderAccount;

export type Client<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
> = {
  chain?: StacksChain;
  account?: Account;
  transport: Transport;
  request: RequestFn;
  extend: <const TNew extends Record<string, unknown>>(
    fn: (client: Client<TExtended>) => TNew
  ) => Client<TExtended & TNew> & TNew;
} & TExtended;

export type ClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
  account?: Account;
};

export type PublicClient<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended>;

export type WalletClient<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended> & { account: Account };
