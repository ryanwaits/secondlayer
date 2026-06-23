// Clients
export {
	createClient,
	createPublicClient,
	createWalletClient,
	createMultiSigClient,
	publicActions,
	walletActions,
	multisigActions,
} from "./clients/index.ts";
export type {
	Client,
	ClientConfig,
	PublicClient,
	WalletClient,
	Account,
	PublicClientConfig,
	WalletClientConfig,
	PublicActions,
	WalletActions,
	MultiSigClientConfig,
	MultiSigClient,
	MultiSigActions,
} from "./clients/index.ts";

// Nonce management
export {
	createNonceManager,
	jsonRpcSource,
	memoryStore,
	resolveNonce,
	isNonceConflictError,
	broadcastWithNonceReset,
} from "./actions/wallet/nonceManager.ts";
export type {
	NonceManager,
	NonceManagerSource,
	NonceStore,
	CreateNonceManagerParams,
} from "./actions/wallet/nonceManager.ts";
export { redisStore, postgresStore } from "./actions/wallet/nonceStores.ts";
export type {
	RedisLike,
	RedisStoreParams,
	SqlLike,
	PostgresStoreParams,
} from "./actions/wallet/nonceStores.ts";

// Transports
export { http } from "./transports/http.ts";
export { custom } from "./transports/custom.ts";
export { fallback } from "./transports/fallback.ts";
export { webSocket } from "./transports/webSocket.ts";
export type {
	WebSocketTransport,
	WebSocketTransportConfig,
} from "./transports/webSocket.ts";
export type {
	Transport,
	TransportFactory,
	TransportConfig,
	RequestFn,
	RequestOptions,
} from "./transports/types.ts";

// Subscriptions (WebSocket address watchers)
export type { Subscription } from "./subscriptions/types.ts";

// `on.*` filter factories for @secondlayer/sdk subscriptions.
// Usage: `import { on } from "@secondlayer/stacks"; on.transferTo(target, ...)`.
export * as on from "./on/index.ts";
export type {
	BnsAction,
	FactoryTarget,
	Filter,
	FilterClause,
	FilterOperator,
	FilterPrimitive,
	PoxFunction,
	SubscriptionFilterSpec,
} from "./on/index.ts";

// Accounts
export { providerToAccount } from "./accounts/providerToAccount.ts";
export type {
	StacksProvider,
	ProviderAccount,
	LocalAccount,
	CustomAccount,
} from "./accounts/types.ts";

// Chains (re-export common ones for convenience)
export { mainnet, testnet, devnet, mocknet } from "./chains/definitions.ts";
export { defineChain } from "./chains/defineChain.ts";
export type { StacksChain } from "./chains/types.ts";

// Utils (re-export most-used for convenience)
export { formatStx, parseStx } from "./utils/units.ts";
export {
	ZERO_ADDRESS,
	TESTNET_ZERO_ADDRESS,
	AddressVersion,
	MICROSTX_PER_STX,
} from "./utils/constants.ts";
export {
	isValidAddress,
	isAddressEqual,
	getContractAddress,
} from "./utils/address.ts";

// Errors
export {
	BaseError,
	TransactionError,
	BroadcastError,
	SerializationError,
	SigningError,
	ContractCallError,
	ReadOnlyCallError,
	WebSocketError,
	SimulationError,
} from "./errors/index.ts";
