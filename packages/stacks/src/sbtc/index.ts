import type { Client } from "../clients/types.ts";
import {
	getBalance,
	getDecimals,
	getName,
	getSymbol,
	getTokenUri,
	getTotalSupply,
} from "./actions.ts";

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
		},
	});
}
