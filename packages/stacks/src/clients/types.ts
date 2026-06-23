import type {
	CustomAccount,
	LocalAccount,
	ProviderAccount,
} from "../accounts/types.ts";
import type { NonceManager } from "../actions/wallet/nonceManager.ts";
import type { StacksChain } from "../chains/types.ts";
import type {
	RequestFn,
	Transport,
	TransportFactory,
} from "../transports/types.ts";

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
	/** Optional nonce manager for mempool-safe sequential nonces across rapid broadcasts. */
	nonceManager?: NonceManager;
	extend: <const TNew extends Record<string, unknown>>(
		fn: (client: Client<TExtended>) => TNew,
	) => Client<TExtended & TNew> & TNew;
} & TExtended;

/** Configuration for creating a base {@link Client}. */
export type ClientConfig = {
	chain?: StacksChain;
	transport: TransportFactory;
	account?: Account;
	/** Optional nonce manager threaded onto the client (see {@link createNonceManager}). */
	nonceManager?: NonceManager;
};

/** A client pre-extended with read-only {@link PublicActions}. */
export type PublicClient<
	TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended>;

/** A client pre-extended with {@link WalletActions} and a required account. */
export type WalletClient<
	TExtended extends Record<string, unknown> = Record<string, unknown>,
> = Client<TExtended> & { account: Account };
