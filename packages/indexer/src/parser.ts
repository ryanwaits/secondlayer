import type { InsertBlock, InsertTransaction, InsertEvent } from "@secondlayer/shared/db/schema";
import type {
  NewBlockPayload,
  TransactionPayload,
  TransactionEvent,
} from "./types/node-events.ts";
import { logger } from "@secondlayer/shared/logger";
import {
  deserializeTransaction,
  PayloadType,
  AddressHashMode,
  type ContractCallPayload,
  type SmartContractPayload,
} from "@secondlayer/stacks/transactions";
import { AddressVersion, c32address } from "@secondlayer/stacks/utils";

// Stacks API URL for fallback tx lookups
// Uses local stacks-blockchain-api if available, otherwise falls back to Hiro public API
const STACKS_API_URL = process.env.STACKS_API_URL || "https://api.hiro.so";

/**
 * Fetch transaction details from Stacks API
 * Used as fallback when raw_tx decode fails
 */
async function fetchTxFromApi(txid: string): Promise<{
  txType: string;
  sender: string;
  contractId: string | null;
  functionName: string | null;
} | null> {
  try {
    const response = await fetch(`${STACKS_API_URL}/extended/v1/tx/${txid}`);
    if (!response.ok) {
      logger.debug("Failed to fetch tx from API", { txid, status: response.status });
      return null;
    }

    const data = await response.json() as {
      tx_type?: string;
      sender_address?: string;
      contract_call?: { contract_id: string; function_name: string };
      smart_contract?: { contract_id: string };
    };

    let contractId: string | null = null;
    let functionName: string | null = null;

    if (data.tx_type === "contract_call" && data.contract_call) {
      contractId = data.contract_call.contract_id;
      functionName = data.contract_call.function_name;
    } else if (data.tx_type === "smart_contract" && data.smart_contract) {
      contractId = data.smart_contract.contract_id;
    }

    return {
      txType: data.tx_type || "unknown",
      sender: data.sender_address || "unknown",
      contractId,
      functionName,
    };
  } catch (error) {
    logger.debug("Error fetching tx from API", { txid, error: String(error) });
    return null;
  }
}

/**
 * Transaction type names matching what we store in the database
 */
const TX_TYPE_NAMES: Record<PayloadType, string> = {
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

/**
 * Decode raw_tx hex to extract tx_type and sender_address
 */
function decodeRawTx(rawTx: string, txid?: string): {
  txType: string;
  sender: string;
  contractId: string | null;
  functionName: string | null;
} | null {
  try {
    const tx = deserializeTransaction(rawTx);

    // Get tx type
    const txType = TX_TYPE_NAMES[tx.payload.payloadType] ?? "unknown";

    // Get sender address from spending condition
    const { signer, hashMode } = tx.auth.spendingCondition;

    // Determine address version based on tx version and hash mode
    // tx.version: 0 = mainnet, 128 = testnet
    const isMainnet = tx.version === 0;
    const isSingleSig = hashMode === AddressHashMode.P2PKH || hashMode === AddressHashMode.P2WPKH;

    let addressVersion: AddressVersion;
    if (isMainnet) {
      addressVersion = isSingleSig ? AddressVersion.MainnetSingleSig : AddressVersion.MainnetMultiSig;
    } else {
      addressVersion = isSingleSig ? AddressVersion.TestnetSingleSig : AddressVersion.TestnetMultiSig;
    }

    const sender = c32address(addressVersion, signer);

    // Extract contract details if applicable
    let contractId: string | null = null;
    let functionName: string | null = null;

    if (tx.payload.payloadType === PayloadType.ContractCall) {
      const payload = tx.payload as ContractCallPayload;
      contractId = `${payload.contractAddress}.${payload.contractName}`;
      functionName = payload.functionName;
    } else if (
      tx.payload.payloadType === PayloadType.SmartContract ||
      tx.payload.payloadType === PayloadType.VersionedSmartContract
    ) {
      const payload = tx.payload as SmartContractPayload;
      contractId = `${sender}.${payload.contractName}`;
    }

    return { txType, sender, contractId, functionName };
  } catch (error) {
    // Some transactions can't be decoded - log for debugging and use fallback values
    logger.warn("Failed to decode raw_tx", { txid, error: String(error).split("\n")[0] });
    return null;
  }
}

export function parseBlock(payload: NewBlockPayload): InsertBlock {
  return {
    height: payload.block_height,
    hash: payload.block_hash,
    parent_hash: payload.parent_block_hash,
    burn_block_height: payload.burn_block_height,
    // Genesis block may have no timestamp - use 0 as default
    timestamp: payload.timestamp ?? 0,
    canonical: true,
  };
}

export async function parseTransaction(
  tx: TransactionPayload,
  blockHeight: number
): Promise<InsertTransaction | null> {
  // Skip if no txid (completely malformed)
  if (!tx.txid) {
    return null;
  }

  // Decode raw_tx to extract tx_type and sender_address
  // The Stacks node events observer sends raw_tx but not tx_type or sender_address
  let decoded = tx.raw_tx ? decodeRawTx(tx.raw_tx, tx.txid) : null;

  // If decode failed, try fetching from Stacks API
  if (!decoded && tx.txid) {
    decoded = await fetchTxFromApi(tx.txid);
    if (decoded) {
      logger.debug("Fetched tx details from API", { txid: tx.txid, type: decoded.txType });
    }
  }

  // Use decoded values, falling back to payload values if available, then defaults
  const txType = decoded?.txType ?? tx.tx_type ?? "unknown";
  const sender = decoded?.sender ?? tx.sender_address ?? "unknown";
  let contractId = decoded?.contractId ?? null;
  let functionName = decoded?.functionName ?? null;

  // If decoding failed but payload has contract info, use that as fallback
  if (!decoded) {
    if (tx.tx_type === "contract_call") {
      const contractCall = (tx as any).contract_call;
      if (contractCall) {
        contractId = contractCall.contract_id;
        functionName = contractCall.function_name;
      }
    } else if (tx.tx_type === "smart_contract") {
      const smartContract = (tx as any).smart_contract;
      if (smartContract) {
        contractId = smartContract.contract_id;
      }
    }
  }

  return {
    tx_id: tx.txid,
    block_height: blockHeight,
    type: txType,
    sender,
    status: tx.status ?? "success",
    contract_id: contractId,
    function_name: functionName,
    raw_tx: tx.raw_tx,
  };
}

export function parseEvent(
  txEvent: TransactionEvent,
  blockHeight: number
): InsertEvent | null {
  const { txid, event_index, type } = txEvent;

  // Skip if type is missing
  if (!type) {
    return null;
  }

  // Extract the actual event data based on type (flat structure)
  let eventData: any;

  switch (type) {
    case "stx_transfer_event":
      eventData = txEvent.stx_transfer_event;
      break;
    case "stx_mint_event":
      eventData = txEvent.stx_mint_event;
      break;
    case "stx_burn_event":
      eventData = txEvent.stx_burn_event;
      break;
    case "stx_lock_event":
      eventData = txEvent.stx_lock_event;
      break;
    case "ft_transfer_event":
      eventData = txEvent.ft_transfer_event;
      break;
    case "ft_mint_event":
      eventData = txEvent.ft_mint_event;
      break;
    case "ft_burn_event":
      eventData = txEvent.ft_burn_event;
      break;
    case "nft_transfer_event":
      eventData = txEvent.nft_transfer_event;
      break;
    case "nft_mint_event":
      eventData = txEvent.nft_mint_event;
      break;
    case "nft_burn_event":
      eventData = txEvent.nft_burn_event;
      break;
    case "smart_contract_event":
      eventData = txEvent.smart_contract_event;
      break;
    default:
      eventData = txEvent;
  }

  return {
    tx_id: txid,
    block_height: blockHeight,
    event_index: event_index,
    type,
    data: eventData,
  };
}
