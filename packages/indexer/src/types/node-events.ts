// Stacks node event payload types
// Based on the Stacks node events observer API

// Transaction types
export type TransactionType =
  | "token_transfer"
  | "smart_contract"
  | "contract_call"
  | "poison_microblock"
  | "coinbase"
  | "tenure_change";

export type TransactionStatus = "success" | "abort_by_response" | "abort_by_post_condition";

// Event types
export type EventType =
  | "stx_transfer_event"
  | "stx_mint_event"
  | "stx_burn_event"
  | "stx_lock_event"
  | "ft_transfer_event"
  | "ft_mint_event"
  | "ft_burn_event"
  | "nft_transfer_event"
  | "nft_mint_event"
  | "nft_burn_event"
  | "smart_contract_event";

// STX Transfer Event
export interface StxTransferEvent {
  type: "stx_transfer_event";
  stx_transfer_event: {
    sender: string;
    recipient: string;
    amount: string;
  };
}

// STX Mint Event
export interface StxMintEvent {
  type: "stx_mint_event";
  stx_mint_event: {
    recipient: string;
    amount: string;
  };
}

// STX Burn Event
export interface StxBurnEvent {
  type: "stx_burn_event";
  stx_burn_event: {
    sender: string;
    amount: string;
  };
}

// STX Lock Event
export interface StxLockEvent {
  type: "stx_lock_event";
  stx_lock_event: {
    locked_amount: string;
    unlock_height: string;
    locked_address: string;
  };
}

// FT Transfer Event
export interface FtTransferEvent {
  type: "ft_transfer_event";
  ft_transfer_event: {
    asset_identifier: string;
    sender: string;
    recipient: string;
    amount: string;
  };
}

// FT Mint Event
export interface FtMintEvent {
  type: "ft_mint_event";
  ft_mint_event: {
    asset_identifier: string;
    recipient: string;
    amount: string;
  };
}

// FT Burn Event
export interface FtBurnEvent {
  type: "ft_burn_event";
  ft_burn_event: {
    asset_identifier: string;
    sender: string;
    amount: string;
  };
}

// NFT Transfer Event
export interface NftTransferEvent {
  type: "nft_transfer_event";
  nft_transfer_event: {
    asset_identifier: string;
    sender: string;
    recipient: string;
    value: any; // Clarity value
  };
}

// NFT Mint Event
export interface NftMintEvent {
  type: "nft_mint_event";
  nft_mint_event: {
    asset_identifier: string;
    recipient: string;
    value: any; // Clarity value
  };
}

// NFT Burn Event
export interface NftBurnEvent {
  type: "nft_burn_event";
  nft_burn_event: {
    asset_identifier: string;
    sender: string;
    value: any; // Clarity value
  };
}

// Smart Contract Event (print)
export interface SmartContractEvent {
  type: "smart_contract_event";
  smart_contract_event: {
    contract_identifier: string;
    topic: string;
    value: any; // Clarity value
  };
}

// Union type for all events
export type EventPayload =
  | StxTransferEvent
  | StxMintEvent
  | StxBurnEvent
  | StxLockEvent
  | FtTransferEvent
  | FtMintEvent
  | FtBurnEvent
  | NftTransferEvent
  | NftMintEvent
  | NftBurnEvent
  | SmartContractEvent;

// Transaction payload
// Note: tx_type and sender_address are optional because the Stacks node events
// observer doesn't include them - they must be decoded from raw_tx
export interface TransactionPayload {
  txid: string;
  raw_tx: string;
  status: TransactionStatus;
  tx_index: number;
  tx_type?: TransactionType;
  sender_address?: string;
  sponsor_address?: string;
  contract_abi?: string | null;
  execution_cost?: {
    read_count: number;
    read_length: number;
    runtime: number;
    write_count: number;
    write_length: number;
  };
  raw_result?: string;
}

// Contract call transaction specific fields
export interface ContractCallTransaction extends TransactionPayload {
  tx_type: "contract_call";
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: string[];
  };
}

// Smart contract deploy specific fields
export interface SmartContractTransaction extends TransactionPayload {
  tx_type: "smart_contract";
  smart_contract?: {
    contract_id: string;
    source_code: string;
  };
}

// Transaction event (as it appears in the block payload)
// Note: The event data is flat, not nested under an "event" key
export interface TransactionEvent {
  txid: string;
  event_index: number;
  committed?: boolean;
  type: EventType;
  // Event-specific data (one of these will be present based on type)
  stx_transfer_event?: {
    sender: string;
    recipient: string;
    amount: string;
    memo?: string;
  };
  stx_mint_event?: {
    recipient: string;
    amount: string;
  };
  stx_burn_event?: {
    sender: string;
    amount: string;
  };
  stx_lock_event?: {
    locked_amount: string;
    unlock_height: string;
    locked_address: string;
  };
  ft_transfer_event?: {
    asset_identifier: string;
    sender: string;
    recipient: string;
    amount: string;
  };
  ft_mint_event?: {
    asset_identifier: string;
    recipient: string;
    amount: string;
  };
  ft_burn_event?: {
    asset_identifier: string;
    sender: string;
    amount: string;
  };
  nft_transfer_event?: {
    asset_identifier: string;
    sender: string;
    recipient: string;
    value: any;
  };
  nft_mint_event?: {
    asset_identifier: string;
    recipient: string;
    value: any;
  };
  nft_burn_event?: {
    asset_identifier: string;
    sender: string;
    value: any;
  };
  smart_contract_event?: {
    contract_identifier: string;
    topic: string;
    value: any;
  };
}

// Matured miner rewards
export interface MaturedMinerReward {
  from_stacks_block_hash: string;
  from_index_block_hash: string;
  recipient: string;
  coinbase_amount: string;
  tx_fees_anchored: string;
  tx_fees_streamed_confirmed: string;
  tx_fees_streamed_produced: string;
}

// New block payload (main event)
export interface NewBlockPayload {
  block_hash: string;
  block_height: number;
  index_block_hash: string;
  parent_block_hash: string;
  parent_index_block_hash: string;
  burn_block_hash: string;
  burn_block_height: number;
  burn_block_timestamp: number;
  miner_txid: string;
  timestamp: number;
  transactions: TransactionPayload[];
  events: TransactionEvent[];
  matured_miner_rewards?: MaturedMinerReward[];
}

// New burn block payload
export interface NewBurnBlockPayload {
  burn_block_hash: string;
  burn_block_height: number;
  burn_block_timestamp: number;
  stacks_blocks: string[];
}

// Mempool transaction payloads (no-op for v1)
export interface NewMempoolTxPayload {
  txid: string;
  raw_tx: string;
  status: string;
}

export interface DropMempoolTxPayload {
  txid: string;
  reason: string;
}
