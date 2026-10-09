/**
 * Raw Stacks transaction -> the summary fields Secondlayer stores per tx.
 */
import { serializeCV } from "@secondlayer/stacks/clarity";
import {
	AddressHashMode,
	type ContractCallPayload,
	PayloadType,
	type SmartContractPayload,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";
import { AddressVersion, c32address } from "@secondlayer/stacks/utils";
import { logger } from "../logger.ts";

/**
 * Transaction type names matching what we store in the database
 */
export const TX_TYPE_NAMES: Record<PayloadType, string> = {
	[PayloadType.TokenTransfer]: "token_transfer",
	[PayloadType.SmartContract]: "smart_contract",
	[PayloadType.VersionedSmartContract]: "smart_contract",
	[PayloadType.ContractCall]: "contract_call",
	[PayloadType.PoisonMicroblock]: "poison_microblock",
	[PayloadType.Coinbase]: "coinbase",
	[PayloadType.CoinbaseToAltRecipient]: "coinbase",
	[PayloadType.TenureChange]: "tenure_change",
	[PayloadType.NakamotoCoinbase]: "coinbase",
};

/** The columnar fields a `transactions` row (and so a handler's `ctx.tx`)
 *  carries, decoded from the raw tx bytes. */
export interface TxSummary {
	txType: string;
	sender: string;
	contractId: string | null;
	functionName: string | null;
	functionArgs: string[] | null;
}

/**
 * Decode raw_tx hex to the stored tx type, sender and call target. One
 * decoder for block ingest, mempool ingest and subgraph replay, so a replayed
 * `ctx.tx` is byte-for-byte the indexed one. Pure CPU (deserialize + c32), no
 * network fallback. Null when the bytes do not decode.
 */
export function decodeRawTx(rawTx: string, txid?: string): TxSummary | null {
	try {
		const tx = deserializeTransaction(rawTx);

		// Get tx type
		const txType = TX_TYPE_NAMES[tx.payload.payloadType] ?? "unknown";

		// Get sender address from spending condition
		const { signer, hashMode } = tx.auth.spendingCondition;

		// Determine address version based on tx version and hash mode
		// tx.version: 0 = mainnet, 128 = testnet
		const isMainnet = tx.version === 0;
		const isSingleSig =
			hashMode === AddressHashMode.P2PKH || hashMode === AddressHashMode.P2WPKH;

		let addressVersion: AddressVersion;
		if (isMainnet) {
			addressVersion = isSingleSig
				? AddressVersion.MainnetSingleSig
				: AddressVersion.MainnetMultiSig;
		} else {
			addressVersion = isSingleSig
				? AddressVersion.TestnetSingleSig
				: AddressVersion.TestnetMultiSig;
		}

		const sender = c32address(addressVersion, signer);

		// Extract contract details if applicable
		let contractId: string | null = null;
		let functionName: string | null = null;
		let functionArgs: string[] | null = null;

		if (tx.payload.payloadType === PayloadType.ContractCall) {
			const payload = tx.payload as ContractCallPayload;
			contractId = `${payload.contractAddress}.${payload.contractName}`;
			functionName = payload.functionName;
			functionArgs = payload.functionArgs?.map((cv) => serializeCV(cv)) ?? null;
		} else if (
			tx.payload.payloadType === PayloadType.SmartContract ||
			tx.payload.payloadType === PayloadType.VersionedSmartContract
		) {
			const payload = tx.payload as SmartContractPayload;
			contractId = `${sender}.${payload.contractName}`;
		}

		return { txType, sender, contractId, functionName, functionArgs };
	} catch (error) {
		// Some transactions can't be decoded - log for debugging and use fallback values
		logger.warn("Failed to decode raw_tx", {
			txid,
			error: String(error).split("\n")[0],
		});
		return null;
	}
}
