import type { StacksChain } from "../chains/types.ts";
import type { Transport, TransportFactory, RequestFn } from "../transports/types.ts";
import type { LocalAccount, CustomAccount, ProviderAccount } from "../accounts/types.ts";

/** Union of all supported account types (local key, custom signer, or browser provider). */
export type Account = LocalAccount | CustomAccount | ProviderAccount;

/**
 * Core client instance that holds chain context, transport, and extensible actions.
 * Created via {@link createClient}, {@link createPublicClient}, or {@link createWalletClient}.
 */
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

/** Configuration for creating a base {@link Client}. */
export type ClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
  account?: Account;
};

/** A client pre-extended with read-only {@link PublicActions}. */
export type PublicClient<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended>;

/** A client pre-extended with {@link WalletActions} and a required account. */
export type WalletClient<
  TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended> & { account: Account };
