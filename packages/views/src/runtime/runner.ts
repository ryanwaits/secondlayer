import { logger } from "@secondlayer/shared/logger";
import { getErrorMessage } from "@secondlayer/shared";
import type { ViewDefinition } from "../types.ts";
import type { ViewContext } from "./context.ts";
import type { MatchedTx } from "./source-matcher.ts";
import { decodeEventData } from "./clarity.ts";

/** Max consecutive handler errors before marking view as error */
const DEFAULT_ERROR_THRESHOLD = 50;

export interface RunResult {
  processed: number;
  errors: number;
}

/**
 * Resolve the handler for a matched tx.
 * Looks up by sourceKey first, then falls back to "*" catch-all.
 */
function resolveHandler(handlers: ViewDefinition["handlers"], key: string) {
  return handlers[key] ?? handlers["*"] ?? null;
}

/**
 * Run a view's keyed handlers against all matched transactions/events.
 *
 * Each MatchedTx carries a sourceKey from the matcher. The runner looks up
 * the corresponding handler in view.handlers, falling back to "*".
 *
 * Does NOT flush — caller is responsible for flushing ctx after run.
 */
export async function runHandlers(
  view: ViewDefinition,
  matched: MatchedTx[],
  ctx: ViewContext,
  opts?: { errorThreshold?: number },
): Promise<RunResult> {
  let processed = 0;
  let errors = 0;
  const threshold = opts?.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;

  for (const { tx, events, sourceKey } of matched) {
    const handler = resolveHandler(view.handlers, sourceKey);
    if (!handler) {
      logger.warn("No handler found for source key", { view: view.name, sourceKey, txId: tx.tx_id });
      continue;
    }

    ctx.setTx({
      txId: tx.tx_id,
      sender: tx.sender,
      type: tx.type,
      status: tx.status,
    });

    // If no events but tx matched, call handler with tx-level data
    if (events.length === 0) {
      try {
        const txPayload: Record<string, unknown> = {
          tx: {
            txId: tx.tx_id,
            sender: tx.sender,
            type: tx.type,
            status: tx.status,
            contractId: tx.contract_id,
            functionName: tx.function_name,
          },
        };
        await handler(txPayload, ctx);
        processed++;
      } catch (err) {
        errors++;
        logger.error("View handler error", {
          view: view.name,
          sourceKey,
          txId: tx.tx_id,
          error: getErrorMessage(err),
        });
      }
      continue;
    }

    for (const event of events) {
      if (errors >= threshold) {
        logger.error("View error threshold reached, skipping remaining events", {
          view: view.name,
          errors,
          threshold,
        });
        return { processed, errors };
      }

      try {
        const decoded = decodeEventData(event.data) as Record<string, unknown>;
        const eventPayload: Record<string, unknown> = {
          ...decoded,
          _eventId: event.id,
          _eventType: event.type,
          _eventIndex: event.event_index,
          tx: {
            txId: tx.tx_id,
            sender: tx.sender,
            type: tx.type,
            status: tx.status,
            contractId: tx.contract_id,
            functionName: tx.function_name,
          },
        };

        await handler(eventPayload, ctx);
        processed++;
      } catch (err) {
        errors++;
        logger.error("View handler error", {
          view: view.name,
          sourceKey,
          txId: tx.tx_id,
          eventId: event.id,
          eventType: event.type,
          error: getErrorMessage(err),
        });
      }
    }
  }

  return { processed, errors };
}
