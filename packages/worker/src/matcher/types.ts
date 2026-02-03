import type { Event, Transaction } from "@secondlayer/shared/db/schema";

/**
 * A matched event from filter evaluation
 */
export interface MatchedEvent {
  event: Event;
  filterType: string;
}

/**
 * A matched transaction from filter evaluation
 */
export interface MatchedTransaction {
  transaction: Transaction;
  filterType: string;
}

/**
 * Combined result of filter evaluation
 */
export interface MatchResult {
  transactions: MatchedTransaction[];
  events: MatchedEvent[];
  hasMatches: boolean;
}
