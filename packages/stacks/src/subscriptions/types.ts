export type Subscription = {
  unsubscribe: () => void;
};

export type WsEvent =
  | "block"
  | "mempool"
  | "tx_update"
  | "address_tx_update"
  | "address_balance_update"
  | "nft_event"
  | "nft_asset_event"
  | "nft_collection_event";

export type WsSubscribeParams = {
  event: WsEvent;
  tx_id?: string;
  address?: string;
  asset_identifier?: string;
  value?: string;
};

export type BlockNotification = {
  canonical: boolean;
  height: number;
  hash: string;
  index_block_hash: string;
  parent_block_hash: string;
  burn_block_height: number;
  burn_block_hash: string;
  parent_burn_block_hash: string;
  parent_burn_block_height: number;
  parent_index_block_hash: string;
  txs: string[];
};

export type MempoolNotification = {
  tx_id: string;
  tx_type: string;
  tx_status: string;
  receipt_time: number;
  receipt_time_iso: string;
  fee_rate: string;
  sender_address: string;
  sponsor_address?: string;
  nonce: number;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_signature: string;
  };
  token_transfer?: {
    recipient_address: string;
    amount: string;
    memo: string;
  };
};

export type TxUpdateNotification = {
  tx_id: string;
  tx_type: string;
  tx_status: string;
  block_hash?: string;
  block_height?: number;
  burn_block_height?: number;
  burn_block_time?: number;
  tx_result?: {
    hex: string;
    repr: string;
  };
};

export type AddressTxNotification = {
  address: string;
  tx_id: string;
  tx_type: string;
  tx_status: string;
  stx_sent: string;
  stx_received: string;
  stx_transfers: Array<{
    amount: string;
    sender: string;
    recipient: string;
  }>;
  ft_transfers: Array<{
    amount: string;
    asset_identifier: string;
    sender: string;
    recipient: string;
  }>;
  nft_transfers: Array<{
    asset_identifier: string;
    sender: string;
    recipient: string;
    value: { hex: string; repr: string };
  }>;
};

export type AddressBalanceNotification = {
  address: string;
  balance: string;
  total_sent: string;
  total_received: string;
  total_fees_sent: string;
  total_miner_rewards_received: string;
  lock_tx_id: string;
  locked: string;
  lock_height: number;
  burnchain_lock_height: number;
  burnchain_unlock_height: number;
};

export type NftEventNotification = {
  sender: string;
  recipient: string;
  asset_identifier: string;
  asset_event_type: string;
  value: { hex: string; repr: string };
  tx_id: string;
  block_height: number;
};
