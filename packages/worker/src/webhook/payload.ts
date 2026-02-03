import type { Stream, Block } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import type { StreamOptions } from "@secondlayer/shared/schemas";
import type { MatchResult } from "../matcher/index.ts";
import { decodeEventData } from "../decoder.ts";

export interface WebhookPayload {
  streamId: string;
  streamName: string;
  network: string;
  block: {
    height: number;
    hash: string;
    parentHash: string;
    burnBlockHeight: number;
    timestamp: number;
  };
  matches: {
    transactions: Array<{
      txId: string;
      type: string;
      sender: string;
      status: string;
      contractId: string | null;
      functionName: string | null;
      rawTx?: string;
    }>;
    events: Array<{
      txId: string;
      eventIndex: number;
      type: string;
      data: any;
    }>;
  };
  isBackfill: boolean;
  deliveredAt: string;
}

/**
 * Build webhook payload from stream, block, and matches
 */
export function buildPayload(
  stream: Stream,
  block: Block,
  matches: MatchResult,
  isBackfill: boolean
): WebhookPayload {
  const options = parseJsonb<StreamOptions>(stream.options);

  return {
    streamId: stream.id,
    streamName: stream.name,
    network: process.env.STACKS_NETWORK ?? "mainnet",
    block: {
      height: block.height,
      hash: block.hash,
      parentHash: block.parent_hash,
      burnBlockHeight: block.burn_block_height,
      timestamp: block.timestamp,
    },
    matches: {
      transactions: matches.transactions.map((m) => ({
        txId: m.transaction.tx_id,
        type: m.transaction.type,
        sender: m.transaction.sender,
        status: m.transaction.status,
        contractId: m.transaction.contract_id,
        functionName: m.transaction.function_name,
        ...(options.includeRawTx ? { rawTx: m.transaction.raw_tx } : {}),
      })),
      events: matches.events.map((m) => ({
        txId: m.event.tx_id,
        eventIndex: m.event.event_index,
        type: m.event.type,
        data: options.decodeClarityValues !== false
          ? decodeEventData(m.event.data)
          : m.event.data,
      })),
    },
    isBackfill,
    deliveredAt: new Date().toISOString(),
  };
}
