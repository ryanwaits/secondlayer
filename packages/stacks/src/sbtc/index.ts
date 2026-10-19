import type { Client } from "../clients/types.ts";
import {
	type SbtcPegAddressOptions,
	type SbtcSignerSet,
	getBalance,
	getDecimals,
	getName,
	getSignerSet,
	getSignersAddress,
	getSignersPublicKey,
	getSymbol,
	getTokenUri,
	getTotalSupply,
} from "./actions.ts";

export type { SbtcPegAddressOptions, SbtcSignerSet } from "./actions.ts";
export {
	assertRegistryAggregateKey,
	deriveSbtcSigningKey,
	deriveSbtcV2PegOutput,
	SBTC_V2_INTERNAL_KEY,
	SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET,
	SbtcV2MarkerError,
	type SbtcV2PegOutput,
} from "./peg.ts";

export type {
	CompletedDepositEvent,
	KeyRotationEvent,
	SbtcBtcRecipient,
	SbtcEventByTopic,
	SbtcRegistryEvent,
	SbtcTokenBurnEvent,
	SbtcTokenEvent,
	SbtcTokenMintEvent,
	SbtcTokenTransferEvent,
	UpdateProtocolContractEvent,
	WithdrawalAcceptEvent,
	WithdrawalCreateEvent,
	WithdrawalRejectEvent,
} from "./types.ts";

export {
	SBTC_ASSET_IDENTIFIER_MAINNET,
	SBTC_ASSET_IDENTIFIER_TESTNET,
	SBTC_BTC_ADDRESS_VERSION,
	SBTC_CONTRACTS,
	SBTC_DECIMALS,
	SBTC_EVENT_TOPICS,
	SBTC_UNIT_NAME,
	sbtcContractId,
} from "./constants.ts";
export type { SbtcEventTopic, SbtcNetwork } from "./constants.ts";
export {
	bitcoinTxidFromHex,
	bitcoinTxidToHex,
	formatBtcAddress,
	satsToSbtc,
	sbtcToSats,
	validateBitcoinTxid,
} from "./utils.ts";
export { SBTC_TOKEN_ABI } from "./abi.ts";

/** Actions provided by the sBTC extension. */
export type SbtcActions = {
	sbtc: {
		getTotalSupply: () => Promise<bigint>;
		getBalance: (owner: string) => Promise<bigint>;
		getName: () => Promise<string>;
		getSymbol: () => Promise<string>;
		getDecimals: () => Promise<bigint>;
		getTokenUri: () => Promise<string | null>;
		/** Current signer set and threshold from `sbtc-registry`. */
		getSignerSet: () => Promise<SbtcSignerSet>;
		/**
		 * Current signer-set aggregate pubkey (33B compressed) from `sbtc-registry`.
		 * Throws `SbtcV2MarkerError` once the registry holds the v2 marker.
		 */
		getSignersPublicKey: () => Promise<Uint8Array>;
		/**
		 * Signers' peg address (v1 aggregate key or v2 `multi_a`, by Bitcoin
		 * height), network-aware from `client.chain`.
		 */
		getSignersAddress: (options?: SbtcPegAddressOptions) => Promise<string>;
	};
};

/**
 * sBTC extension for the Stacks client.
 *
 * @example
 * import { createWalletClient, http, mainnet } from "stacks";
 * import { sbtc } from "stacks/sbtc";
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * }).extend(sbtc());
 *
 * const supply = await client.sbtc.getTotalSupply();
 * const balance = await client.sbtc.getBalance("SP1...");
 */
export function sbtc(): (client: Client) => SbtcActions {
	return (client: Client) => ({
		sbtc: {
			getTotalSupply: () => getTotalSupply(client),
			getBalance: (owner: string) => getBalance(client, owner),
			getName: () => getName(client),
			getSymbol: () => getSymbol(client),
			getDecimals: () => getDecimals(client),
			getTokenUri: () => getTokenUri(client),
			getSignerSet: () => getSignerSet(client),
			getSignersPublicKey: () => getSignersPublicKey(client),
			getSignersAddress: (options?: SbtcPegAddressOptions) =>
				getSignersAddress(client, options),
		},
	});
}
