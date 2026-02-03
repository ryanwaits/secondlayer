import { type ViewSource, sourceKey } from "../types.ts";

export interface MatchedTx {
  tx: { tx_id: string; type: string; sender: string; status: string; contract_id?: string | null; function_name?: string | null };
  events: { id: string; tx_id: string; type: string; event_index: number; data: unknown }[];
  /** Which source produced this match — used for handler dispatch */
  sourceKey: string;
}

/**
 * Check if a string matches a pattern with `*` wildcard support.
 */
function matchPattern(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) return value === pattern;
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${regex}$`).test(value);
}

type TxRecord = { tx_id: string; type: string; sender: string; status: string; contract_id?: string | null; function_name?: string | null };
type EventRecord = { id: string; tx_id: string; type: string; event_index: number; data: unknown };

/**
 * Match a single source against transactions and events.
 */
function matchSource(
  source: ViewSource,
  transactions: TxRecord[],
  eventsByTx: Map<string, EventRecord[]>,
): MatchedTx[] {
  const results: MatchedTx[] = [];
  const key = sourceKey(source);

  for (const tx of transactions) {
    // Type-based matching (e.g., token_transfer → matches tx.type)
    if (source.type) {
      if (!matchPattern(tx.type, source.type)) continue;

      const txEvents = eventsByTx.get(tx.tx_id) ?? [];

      // Collect all events for this tx (type-based sources match the whole tx)
      let matchedEvents = txEvents;

      // minAmount filter — check events with an amount field
      if (source.minAmount !== undefined) {
        const amountEvents = matchedEvents.filter((e) => {
          const data = e.data as Record<string, unknown> | null;
          const rawAmount = data?.amount as string | number | undefined;
          if (rawAmount === undefined) return false;
          const amount = BigInt(rawAmount);
          return amount >= source.minAmount!;
        });
        if (amountEvents.length === 0) continue;
        matchedEvents = amountEvents;
      }

      results.push({ tx, events: matchedEvents, sourceKey: key });
      continue;
    }

    // Contract-based matching
    if (source.contract) {
      const txContractMatch = tx.contract_id && matchPattern(tx.contract_id, source.contract);

      // Function filter
      if (source.function && tx.function_name) {
        if (!matchPattern(tx.function_name, source.function)) continue;
      } else if (source.function && !tx.function_name) {
        continue;
      }

      const txEvents = eventsByTx.get(tx.tx_id) ?? [];
      let matchedEvents = txEvents;

      if (!txContractMatch) {
        // Check if any events match the contract
        matchedEvents = txEvents.filter((e) => {
          const data = e.data as Record<string, unknown> | null;
          const contractIdentifier = data?.contract_identifier as string | undefined;
          return contractIdentifier && matchPattern(contractIdentifier, source.contract!);
        });
        if (matchedEvents.length === 0) continue;
      }

      // Event type / topic filter
      if (source.event) {
        matchedEvents = matchedEvents.filter((e) => {
          if (matchPattern(e.type, source.event!)) return true;
          const data = e.data as Record<string, unknown> | null;
          const topic = data?.topic as string | undefined;
          return topic ? matchPattern(topic, source.event!) : false;
        });
      }

      if (txContractMatch || matchedEvents.length > 0) {
        results.push({ tx, events: matchedEvents, sourceKey: key });
      }
    }
  }

  return results;
}

/**
 * Match all sources against a block's transactions and events.
 * Deduplicates by (txId, sourceKey) — each handler key fires at most once per tx.
 */
export function matchSources(
  sources: ViewSource[],
  transactions: TxRecord[],
  events: EventRecord[],
): MatchedTx[] {
  // Index events by txId
  const eventsByTx = new Map<string, EventRecord[]>();
  for (const event of events) {
    const list = eventsByTx.get(event.tx_id) ?? [];
    list.push(event);
    eventsByTx.set(event.tx_id, list);
  }

  const seen = new Set<string>();
  const results: MatchedTx[] = [];

  for (const source of sources) {
    const matches = matchSource(source, transactions, eventsByTx);
    for (const match of matches) {
      const dedupeKey = `${match.tx.tx_id}:${match.sourceKey}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        results.push(match);
      }
    }
  }

  return results;
}
