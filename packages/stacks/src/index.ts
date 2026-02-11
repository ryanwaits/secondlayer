// Clients
export {
  createClient,
  createPublicClient as createReadClient,
  createWalletClient,
  createMultiSigClient,
  publicActions as readActions,
  walletActions,
  multisigActions,
} from "./clients/index.ts";
export type {
  Client,
  ClientConfig,
  PublicClient as ReadClient,
  WalletClient,
  Account,
  PublicClientConfig as ReadClientConfig,
  WalletClientConfig,
  PublicActions as ReadActions,
  WalletActions,
  MultiSigClientConfig,
  MultiSigClient,
  MultiSigActions,
} from "./clients/index.ts";

// Transports
export { http } from "./transports/http.ts";
export { custom } from "./transports/custom.ts";
export { fallback } from "./transports/fallback.ts";
export { webSocket } from "./transports/webSocket.ts";
export type { WebSocketTransport, WebSocketTransportConfig } from "./transports/webSocket.ts";
export type { Transport, TransportFactory, TransportConfig, RequestFn, RequestOptions } from "./transports/types.ts";

// Subscriptions
export type { Subscription } from "./subscriptions/types.ts";

// Accounts
export { providerToAccount } from "./accounts/providerToAccount.ts";
export type { StacksProvider, ProviderAccount, LocalAccount, CustomAccount } from "./accounts/types.ts";

// Chains (re-export common ones for convenience)
export { mainnet, testnet, devnet, mocknet } from "./chains/definitions.ts";
export { defineChain } from "./chains/defineChain.ts";
export type { StacksChain } from "./chains/types.ts";

// Utils (re-export most-used for convenience)
export { formatStx as formatMicroStx, parseStx } from "./utils/units.ts";
export { ZERO_ADDRESS as NULL_ADDRESS, AddressVersion, MICROSTX_PER_STX } from "./utils/constants.ts";
export { isValidAddress, getContractAddress } from "./utils/address.ts";
