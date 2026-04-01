import { getErrorMessage } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";
import { decodeEventData } from "./clarity.ts";
import type { SubgraphContext } from "./context.ts";
import type { MatchedTx } from "./source-matcher.ts";

/** Max consecutive handler errors before marking subgraph as error */
const DEFAULT_ERROR_THRESHOLD = 50;

export interface RunResult {
	processed: number;
	errors: number;
}

/**
 * Resolve the handler for a matched tx.
 * Looks up by sourceKey first, then falls back to "*" catch-all.
 */
function resolveHandler(handlers: SubgraphDefinition["handlers"], key: string) {
	return handlers[key] ?? handlers["*"] ?? null;
}

/**
 * Run a subgraph's keyed handlers against all matched transactions/events.
 *
 * Each MatchedTx carries a sourceKey from the matcher. The runner looks up
 * the corresponding handler in subgraph.handlers, falling back to "*".
 *
 * Does NOT flush — caller is responsible for flushing ctx after run.
 */
export async function runHandlers(
	subgraph: SubgraphDefinition,
	matched: MatchedTx[],
	ctx: SubgraphContext,
	opts?: { errorThreshold?: number },
): Promise<RunResult> {
	let processed = 0;
	let errors = 0;
	const threshold = opts?.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;

	for (const { tx, events, sourceKey } of matched) {
		const handler = resolveHandler(subgraph.handlers, sourceKey);
		if (!handler) {
			logger.warn("No handler found for source key", {
				subgraph: subgraph.name,
				sourceKey,
				txId: tx.tx_id,
			});
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
				logger.error("Subgraph handler error", {
					subgraph: subgraph.name,
					sourceKey,
					txId: tx.tx_id,
					error: getErrorMessage(err),
				});
			}
			continue;
		}

		for (const event of events) {
			if (errors >= threshold) {
				logger.error(
					"Subgraph error threshold reached, skipping remaining events",
					{
						subgraph: subgraph.name,
						errors,
						threshold,
					},
				);
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
				logger.error("Subgraph handler error", {
					subgraph: subgraph.name,
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
