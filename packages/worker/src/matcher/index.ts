import type { Event, Transaction } from "@secondlayer/shared/db/schema";
import type { StreamFilter } from "@secondlayer/shared/schemas/filters";
import type { MatchResult, MatchedEvent, MatchedTransaction } from "./types.ts";

import { matchStxTransfer, matchStxMint, matchStxBurn, matchStxLock } from "./stx.ts";
import { matchFtTransfer, matchFtMint, matchFtBurn } from "./ft.ts";
import { matchNftTransfer, matchNftMint, matchNftBurn } from "./nft.ts";
import { matchContractCall, matchContractDeploy, matchPrintEvent } from "./contract.ts";

export type { MatchResult, MatchedEvent, MatchedTransaction };

/**
 * Evaluate a single filter against transactions and events
 */
function evaluateFilter(
  filter: StreamFilter,
  transactions: Transaction[],
  events: Event[]
): { transactions: MatchedTransaction[]; events: MatchedEvent[] } {
  switch (filter.type) {
    // STX events
    case "stx_transfer":
      return { transactions: [], events: matchStxTransfer(filter, events) };
    case "stx_mint":
      return { transactions: [], events: matchStxMint(filter, events) };
    case "stx_burn":
      return { transactions: [], events: matchStxBurn(filter, events) };
    case "stx_lock":
      return { transactions: [], events: matchStxLock(filter, events) };

    // FT events
    case "ft_transfer":
      return { transactions: [], events: matchFtTransfer(filter, events) };
    case "ft_mint":
      return { transactions: [], events: matchFtMint(filter, events) };
    case "ft_burn":
      return { transactions: [], events: matchFtBurn(filter, events) };

    // NFT events
    case "nft_transfer":
      return { transactions: [], events: matchNftTransfer(filter, events) };
    case "nft_mint":
      return { transactions: [], events: matchNftMint(filter, events) };
    case "nft_burn":
      return { transactions: [], events: matchNftBurn(filter, events) };

    // Contract events
    case "contract_call":
      return { transactions: matchContractCall(filter, transactions), events: [] };
    case "contract_deploy":
      return { transactions: matchContractDeploy(filter, transactions), events: [] };
    case "print_event":
      return { transactions: [], events: matchPrintEvent(filter, events) };

    default:
      return { transactions: [], events: [] };
  }
}

/**
 * Evaluate all filters against transactions and events (OR logic)
 * Returns deduplicated results
 */
export function evaluateFilters(
  filters: StreamFilter[],
  transactions: Transaction[],
  events: Event[]
): MatchResult {
  const matchedTxIds = new Set<string>();
  const matchedEventIds = new Set<string>();
  const matchedTransactions: MatchedTransaction[] = [];
  const matchedEvents: MatchedEvent[] = [];

  for (const filter of filters) {
    const result = evaluateFilter(filter, transactions, events);

    // Deduplicate transactions
    for (const match of result.transactions) {
      if (!matchedTxIds.has(match.transaction.tx_id)) {
        matchedTxIds.add(match.transaction.tx_id);
        matchedTransactions.push(match);
      }
    }

    // Deduplicate events
    for (const match of result.events) {
      if (!matchedEventIds.has(match.event.id)) {
        matchedEventIds.add(match.event.id);
        matchedEvents.push(match);
      }
    }
  }

  return {
    transactions: matchedTransactions,
    events: matchedEvents,
    hasMatches: matchedTransactions.length > 0 || matchedEvents.length > 0,
  };
}
