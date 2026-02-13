/**
 * Hiro public API client for backfilling historical block data.
 *
 * The stacks-node RPC `/v2/blocks/{height}` only returns block headers + tx IDs,
 * not full transaction data or events. The Hiro API serves complete block data
 * that we can transform into the NewBlockPayload format our indexer expects.
 */

import { logger } from "../logger.ts";

const DEFAULT_HIRO_API_URL = "https://api.mainnet.hiro.so";

/** v2 /extended/v2/blocks/{height} response */
export interface HiroBlockResponse {
  canonical: boolean;
  height: number;
  hash: string;
  block_time: number;
  block_time_iso: string;
  index_block_hash: string;
  parent_block_hash: string;
  parent_index_block_hash: string;
  burn_block_hash: string;
  burn_block_height: number;
  burn_block_time: number;
  miner_txid: string;
  tx_count: number;
}

/** v2 /extended/v2/blocks/{height}/transactions response */
export interface HiroBlockTxsResponse {
  limit: number;
  offset: number;
  total: number;
  results: HiroTxResponse[];
}

export interface HiroTxResponse {
  tx_id: string;
  tx_type: string;
  tx_status: string;
  sender_address: string;
  fee_rate: string;
  nonce: number;
  block_hash: string;
  block_height: number;
  burn_block_height: number;
  tx_index: number;
  event_count: number;
  token_transfer?: {
    recipient_address: string;
    amount: string;
    memo: string;
  };
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: unknown[];
  };
  smart_contract?: {
    contract_id: string;
    source_code: string;
  };
}

export interface HiroEvent {
  event_index: number;
  event_type: string; // "stx_asset" | "fungible_token_asset" | "non_fungible_token_asset" | "smart_contract_log"
  tx_id: string;
  asset?: {
    asset_event_type: string; // "transfer" | "mint" | "burn"
    sender?: string;
    recipient?: string;
    amount?: string;
    memo?: string;
    asset_id?: string;
    value?: unknown;
  };
  contract_log?: {
    contract_id: string;
    topic: string;
    value: unknown;
  };
}

export interface HiroEventsResponse {
  limit: number;
  offset: number;
  events: HiroEvent[];
}

/** Shape our indexer expects at POST /new_block */
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
  events: TransactionEventPayload[];
}

interface TransactionPayload {
  txid: string;
  raw_tx: string;
  status: string;
  tx_index: number;
  tx_type?: string;
  sender_address?: string;
}

interface TransactionEventPayload {
  txid: string;
  event_index: number;
  committed: boolean;
  type: string;
  stx_transfer_event?: { sender: string; recipient: string; amount: string; memo?: string };
  stx_mint_event?: { recipient: string; amount: string };
  stx_burn_event?: { sender: string; amount: string };
  stx_lock_event?: { locked_amount: string; unlock_height: string; locked_address: string };
  ft_transfer_event?: { asset_identifier: string; sender: string; recipient: string; amount: string };
  ft_mint_event?: { asset_identifier: string; recipient: string; amount: string };
  ft_burn_event?: { asset_identifier: string; sender: string; amount: string };
  nft_transfer_event?: { asset_identifier: string; sender: string; recipient: string; value: unknown };
  nft_mint_event?: { asset_identifier: string; recipient: string; value: unknown };
  nft_burn_event?: { asset_identifier: string; sender: string; value: unknown };
  smart_contract_event?: { contract_identifier: string; topic: string; value: unknown };
}

export interface GetBlockOptions {
  /** Fetch actual raw_tx hex for each transaction (instead of "0x00" placeholder) */
  includeRawTx?: boolean;
  /** Max concurrent raw_tx fetches per block (default: 10) */
  rawTxConcurrency?: number;
}

export class HiroClient {
  private apiUrl: string;
  private fallbackUrl: string | undefined;
  private apiKey: string | undefined;
  private maxRetries: number;

  constructor(apiUrl?: string, maxRetries = 5) {
    this.apiUrl = apiUrl || process.env.HIRO_API_URL || DEFAULT_HIRO_API_URL;
    this.fallbackUrl = process.env.HIRO_FALLBACK_URL;
    this.apiKey = process.env.HIRO_API_KEY;
    this.maxRetries = maxRetries;
  }

  private get headers(): Record<string, string> {
    return this.apiKey ? { "x-hiro-api-key": this.apiKey } : {};
  }

  /** Fetch with retry on 429/5xx using exponential backoff */
  private async fetchWithRetry(url: string, timeoutMs = 15_000): Promise<Response> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const res = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(timeoutMs) });

      if (res.ok || res.status === 404) return res;

      if (res.status === 429 || res.status >= 500) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
        logger.info("Rate limited, retrying", { url: url.split("/").slice(-2).join("/"), attempt, delay });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // 4xx (not 404/429) — don't retry
      return res;
    }

    // Final attempt
    return fetch(url, { headers: this.headers, signal: AbortSignal.timeout(timeoutMs) });
  }

  /**
   * Fetch a complete block by height, including all transactions and events,
   * transformed into the NewBlockPayload format our indexer expects.
   *
   * Uses 3-step approach:
   *   1. GET /extended/v2/blocks/{height} — block metadata
   *   2. GET /extended/v2/blocks/{height}/transactions — all txs (paginated)
   *   3. GET /extended/v1/tx/events?tx_id={txId} — events per tx (only for txs with events)
   */
  async getBlockForIndexer(height: number, options?: GetBlockOptions): Promise<NewBlockPayload | null> {
    // 1. Fetch block metadata (try primary, fallback on 404)
    let block = await this.fetchBlock(height);
    let usingFallback = false;
    if (!block && this.fallbackUrl) {
      block = await this.fetchBlock(height, this.fallbackUrl);
      if (block) usingFallback = true;
    }
    if (!block) return null;

    // 2. Fetch all transactions via v2 block/transactions endpoint
    const baseUrl = usingFallback ? this.fallbackUrl! : this.apiUrl;
    const hiroTxs = await this.fetchBlockTransactions(height, baseUrl);

    const txPayloads: TransactionPayload[] = [];
    const eventPayloads: TransactionEventPayload[] = [];

    for (const hiroTx of hiroTxs) {
      txPayloads.push({
        txid: hiroTx.tx_id,
        raw_tx: "0x00",
        status: mapTxStatus(hiroTx.tx_status),
        tx_index: hiroTx.tx_index ?? 0,
        tx_type: mapTxType(hiroTx.tx_type),
        sender_address: hiroTx.sender_address,
      });

      // 3. Fetch events only for txs that have them
      if (hiroTx.event_count > 0) {
        try {
          const events = await this.fetchAllEvents(hiroTx.tx_id, baseUrl);
          eventPayloads.push(...events);
        } catch (err) {
          logger.warn("Failed to fetch events for backfill", { txId: hiroTx.tx_id, error: String(err) });
        }
      }
    }

    // 4. Optionally fetch raw_tx for all transactions
    if (options?.includeRawTx && txPayloads.length > 0) {
      const txIds = txPayloads.map((t) => t.txid);
      const rawTxMap = await this.fetchRawTxBatch(txIds, options.rawTxConcurrency);
      for (const txPayload of txPayloads) {
        const raw = rawTxMap.get(txPayload.txid);
        if (raw) txPayload.raw_tx = raw;
      }
    }

    return {
      block_hash: block.hash,
      block_height: block.height,
      index_block_hash: block.index_block_hash,
      parent_block_hash: block.parent_block_hash,
      parent_index_block_hash: block.parent_index_block_hash,
      burn_block_hash: block.burn_block_hash,
      burn_block_height: block.burn_block_height,
      burn_block_timestamp: block.burn_block_time,
      miner_txid: block.miner_txid,
      timestamp: block.block_time,
      transactions: txPayloads,
      events: eventPayloads,
    };
  }

  /** v2 block metadata */
  private async fetchBlock(height: number, baseUrl?: string): Promise<HiroBlockResponse | null> {
    const url = baseUrl || this.apiUrl;
    const res = await this.fetchWithRetry(`${url}/extended/v2/blocks/${height}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Hiro API block/${height} returned ${res.status}`);
    return res.json() as Promise<HiroBlockResponse>;
  }

  /** v2 block transactions (paginated) */
  private async fetchBlockTransactions(height: number, baseUrl?: string): Promise<HiroTxResponse[]> {
    const url = baseUrl || this.apiUrl;
    const txs: HiroTxResponse[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const res = await this.fetchWithRetry(
        `${url}/extended/v2/blocks/${height}/transactions?limit=${limit}&offset=${offset}`
      );
      if (!res.ok) throw new Error(`Hiro API block/${height}/transactions returned ${res.status}`);

      const data = (await res.json()) as HiroBlockTxsResponse;
      txs.push(...data.results);

      if (txs.length >= data.total || data.results.length < limit) break;
      offset += limit;
    }

    return txs;
  }

  private async fetchAllEvents(txId: string, baseUrl?: string): Promise<TransactionEventPayload[]> {
    const url = baseUrl || this.apiUrl;
    const events: TransactionEventPayload[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const res = await this.fetchWithRetry(
        `${url}/extended/v1/tx/events?tx_id=${txId}&limit=${limit}&offset=${offset}`
      );
      if (!res.ok) {
        logger.warn("Failed to fetch events from Hiro", { txId, status: res.status });
        break;
      }

      const data = (await res.json()) as HiroEventsResponse;
      for (const hEvent of data.events) {
        const converted = convertHiroEvent(hEvent);
        if (converted) events.push(converted);
      }

      if (data.events.length < limit) break;
      offset += limit;
    }

    return events;
  }

  /** Fetch raw_tx hex for a single transaction */
  async fetchRawTx(txId: string): Promise<string | null> {
    try {
      const res = await this.fetchWithRetry(`${this.apiUrl}/extended/v1/tx/${txId}/raw`, 10_000);
      if (!res.ok) return null;
      const data = (await res.json()) as { raw_tx: string };
      return data.raw_tx || null;
    } catch {
      return null;
    }
  }

  /** Fetch raw_tx for multiple transactions with bounded concurrency */
  async fetchRawTxBatch(txIds: string[], concurrency = 10): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    for (let i = 0; i < txIds.length; i += concurrency) {
      const chunk = txIds.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map(async (txId) => {
          const raw = await this.fetchRawTx(txId);
          return { txId, raw };
        })
      );
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value.raw) {
          results.set(result.value.txId, result.value.raw);
        }
      }
    }
    return results;
  }

  /** Fetch current chain tip height from Hiro API status endpoint */
  async fetchChainTip(): Promise<number> {
    const res = await this.fetchWithRetry(`${this.apiUrl}/extended/v1/status`);
    if (!res.ok) throw new Error(`Hiro API /status returned ${res.status}`);
    const data = (await res.json()) as { chain_tip?: { block_height: number }; stacks_tip_height?: number };
    return data.chain_tip?.block_height ?? data.stacks_tip_height ?? 0;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/extended/v1/status`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getApiUrl(): string {
    return this.apiUrl;
  }
}

/** Map Hiro tx_status to our indexer's expected format */
function mapTxStatus(status: string): string {
  switch (status) {
    case "success":
      return "success";
    case "abort_by_response":
    case "abort_by_post_condition":
      return status;
    default:
      return "success";
  }
}

/** Map Hiro tx_type to node event tx_type */
function mapTxType(type: string): string {
  switch (type) {
    case "token_transfer":
      return "token_transfer";
    case "contract_call":
      return "contract_call";
    case "smart_contract":
      return "smart_contract";
    case "coinbase":
      return "coinbase";
    case "tenure_change":
      return "tenure_change";
    case "poison_microblock":
      return "poison_microblock";
    default:
      return type;
  }
}

/**
 * Convert a Hiro API event to our indexer's TransactionEvent format.
 *
 * Hiro uses:
 *   event_type: "stx_asset" | "fungible_token_asset" | "non_fungible_token_asset" | "smart_contract_log"
 *   asset.asset_event_type: "transfer" | "mint" | "burn" | "lock"
 *
 * Our indexer expects:
 *   type: "stx_transfer_event" | "stx_mint_event" | "ft_transfer_event" | "smart_contract_event" | ...
 */
function convertHiroEvent(hEvent: HiroEvent): TransactionEventPayload | null {
  const base = {
    txid: hEvent.tx_id,
    event_index: hEvent.event_index,
    committed: true,
  };

  if (hEvent.event_type === "stx_asset" && hEvent.asset) {
    const a = hEvent.asset;
    switch (a.asset_event_type) {
      case "transfer":
        return {
          ...base,
          type: "stx_transfer_event",
          stx_transfer_event: {
            sender: a.sender!,
            recipient: a.recipient!,
            amount: a.amount!,
            memo: a.memo,
          },
        };
      case "mint":
        return {
          ...base,
          type: "stx_mint_event",
          stx_mint_event: { recipient: a.recipient!, amount: a.amount! },
        };
      case "burn":
        return {
          ...base,
          type: "stx_burn_event",
          stx_burn_event: { sender: a.sender!, amount: a.amount! },
        };
      case "lock":
        return {
          ...base,
          type: "stx_lock_event",
          stx_lock_event: {
            locked_amount: a.amount!,
            unlock_height: "0",
            locked_address: a.sender!,
          },
        };
    }
  }

  if (hEvent.event_type === "fungible_token_asset" && hEvent.asset) {
    const a = hEvent.asset;
    const assetId = a.asset_id || "";
    switch (a.asset_event_type) {
      case "transfer":
        return {
          ...base,
          type: "ft_transfer_event",
          ft_transfer_event: {
            asset_identifier: assetId,
            sender: a.sender!,
            recipient: a.recipient!,
            amount: a.amount!,
          },
        };
      case "mint":
        return {
          ...base,
          type: "ft_mint_event",
          ft_mint_event: { asset_identifier: assetId, recipient: a.recipient!, amount: a.amount! },
        };
      case "burn":
        return {
          ...base,
          type: "ft_burn_event",
          ft_burn_event: { asset_identifier: assetId, sender: a.sender!, amount: a.amount! },
        };
    }
  }

  if (hEvent.event_type === "non_fungible_token_asset" && hEvent.asset) {
    const a = hEvent.asset;
    const assetId = a.asset_id || "";
    switch (a.asset_event_type) {
      case "transfer":
        return {
          ...base,
          type: "nft_transfer_event",
          nft_transfer_event: {
            asset_identifier: assetId,
            sender: a.sender!,
            recipient: a.recipient!,
            value: a.value,
          },
        };
      case "mint":
        return {
          ...base,
          type: "nft_mint_event",
          nft_mint_event: { asset_identifier: assetId, recipient: a.recipient!, value: a.value },
        };
      case "burn":
        return {
          ...base,
          type: "nft_burn_event",
          nft_burn_event: { asset_identifier: assetId, sender: a.sender!, value: a.value },
        };
    }
  }

  if (hEvent.event_type === "smart_contract_log" && hEvent.contract_log) {
    return {
      ...base,
      type: "smart_contract_event",
      smart_contract_event: {
        contract_identifier: hEvent.contract_log.contract_id,
        topic: hEvent.contract_log.topic,
        value: hEvent.contract_log.value,
      },
    };
  }

  logger.debug("Unknown Hiro event type, skipping", {
    eventType: hEvent.event_type,
    txId: hEvent.tx_id,
  });
  return null;
}
