import { getErrorMessage } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition, SubgraphFilter } from "../types.ts";
import { decodeClarityValue, decodeEventData } from "./clarity.ts";
import type { SubgraphContext } from "./context.ts";
import type { MatchedTx } from "./source-matcher.ts";

/** Max consecutive handler errors before marking subgraph as error */
const DEFAULT_ERROR_THRESHOLD = 50;

export interface RunResult {
	processed: number;
	errors: number;
}

/** Convert kebab-case to camelCase: "bitcoin-txid" → "bitcoinTxid" */
function camelCase(str: string): string {
	return str.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Recursively camelize all object keys */
function camelizeKeys(obj: unknown): unknown {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map(camelizeKeys);
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		result[camelCase(k)] = camelizeKeys(v);
	}
	return result;
}

/**
 * Decode function_args (hex-encoded ClarityValues) to an array of JS values.
 * Returns decoded values via cvToValue.
 */
function decodeFunctionArgs(args: unknown): unknown[] {
	if (!Array.isArray(args)) return [];
	return args.map((arg) => {
		if (typeof arg === "string") return decodeClarityValue(arg);
		return arg;
	});
}

/**
 * Decode raw_result (hex-encoded Clarity return value) to JS value.
 */
function decodeRawResult(raw: unknown): unknown {
	if (typeof raw === "string" && raw.length > 2) {
		return decodeClarityValue(raw);
	}
	return null;
}

/** Safely convert a value to BigInt. Handles string, number, bigint. Returns 0n on failure. */
function safeBigInt(val: unknown): bigint {
	if (typeof val === "bigint") return val;
	if (typeof val === "number") return BigInt(val);
	if (typeof val === "string") {
		try {
			return BigInt(val);
		} catch {
			return 0n;
		}
	}
	return 0n;
}

/**
 * Build a typed event payload based on the source filter type.
 * Returns the payload the handler will receive.
 */
function buildEventPayload(
	filter: SubgraphFilter,
	tx: MatchedTx["tx"],
	event: MatchedTx["events"][0] | null,
): Record<string, unknown> {
	const txMeta = {
		txId: tx.tx_id,
		sender: tx.sender,
		type: tx.type,
		status: tx.status,
		contractId: tx.contract_id ?? null,
		functionName: tx.function_name ?? null,
	};

	// Decoded function args + result for contract_call payloads
	const decodedArgs = decodeFunctionArgs(tx.function_args);
	const decodedResult = decodeRawResult(tx.raw_result);

	// No event — tx-level match (contract_call or contract_deploy)
	if (!event) {
		switch (filter.type) {
			case "contract_call":
				return {
					contractId: tx.contract_id ?? "",
					functionName: tx.function_name ?? "",
					caller: tx.sender,
					args: decodedArgs,
					result: decodedResult,
					resultHex: tx.raw_result ?? null,
					tx: txMeta,
				};
			case "contract_deploy":
				return {
					contractId: tx.contract_id ?? "",
					deployer: tx.sender,
					tx: txMeta,
				};
			default:
				return { tx: txMeta };
		}
	}

	// Decode event data (Clarity values auto-unwrapped via cvToValue)
	const decoded = decodeEventData(event.data) as Record<string, unknown>;

	switch (filter.type) {
		// ── FT events ──
		case "ft_transfer":
			return {
				sender: decoded.sender as string,
				recipient: decoded.recipient as string,
				amount: safeBigInt(decoded.amount),
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "ft_mint":
			return {
				recipient: decoded.recipient as string,
				amount: safeBigInt(decoded.amount),
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "ft_burn":
			return {
				sender: decoded.sender as string,
				amount: safeBigInt(decoded.amount),
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};

		// ── NFT events ──
		case "nft_transfer":
			return {
				sender: decoded.sender as string,
				recipient: decoded.recipient as string,
				tokenId: decoded.value,
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "nft_mint":
			return {
				recipient: decoded.recipient as string,
				tokenId: decoded.value,
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "nft_burn":
			return {
				sender: decoded.sender as string,
				tokenId: decoded.value,
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};

		// ── STX events ──
		case "stx_transfer":
			return {
				sender: decoded.sender as string,
				recipient: decoded.recipient as string,
				amount: safeBigInt(decoded.amount),
				memo: decoded.memo ?? "",
				tx: txMeta,
			};
		case "stx_mint":
			return {
				recipient: decoded.recipient as string,
				amount: safeBigInt(decoded.amount),
				tx: txMeta,
			};
		case "stx_burn":
			return {
				sender: decoded.sender as string,
				amount: safeBigInt(decoded.amount),
				tx: txMeta,
			};
		case "stx_lock":
			return {
				lockedAddress: decoded.locked_address as string,
				lockedAmount: safeBigInt(decoded.locked_amount),
				unlockHeight: safeBigInt(decoded.unlock_height),
				tx: txMeta,
			};

		// ── Print event ──
		case "print_event": {
			const rawValue = decoded.value;
			// Extract topic from decoded Clarity value (not raw event topic which is always "print")
			const clarityObj =
				rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
					? (rawValue as Record<string, unknown>)
					: null;
			const topic = clarityObj?.topic
				? String(clarityObj.topic)
				: ((decoded.topic as string) ?? "");
			// Camelize remaining keys for developer convenience
			const { topic: _, ...rest } = clarityObj ?? {};
			const data =
				Object.keys(rest).length > 0
					? (camelizeKeys(rest) as Record<string, unknown>)
					: rawValue && typeof rawValue !== "object"
						? rawValue
						: {};
			return {
				contractId:
					(decoded.contract_identifier as string) ?? tx.contract_id ?? "",
				topic,
				data: data ?? {},
				tx: txMeta,
			};
		}

		// ── Contract call (with events) ──
		case "contract_call":
			return {
				...decoded,
				_eventType: event.type,
				contractId: tx.contract_id ?? "",
				functionName: tx.function_name ?? "",
				caller: tx.sender,
				args: decodedArgs,
				result: decodedResult,
				resultHex: tx.raw_result ?? null,
				tx: txMeta,
			};

		// ── Contract deploy ──
		case "contract_deploy":
			return {
				contractId: tx.contract_id ?? "",
				deployer: tx.sender,
				tx: txMeta,
			};

		default:
			// Fallback: spread decoded data with tx metadata
			return {
				...decoded,
				_eventType: event.type,
				tx: txMeta,
			};
	}
}

/**
 * Run a subgraph's keyed handlers against all matched transactions/events.
 *
 * Each MatchedTx carries a sourceName from the matcher. The runner looks up
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

	// Build filter lookup from sources (supports both array and named object)
	const filterLookup = new Map<string, SubgraphFilter>();
	if (!Array.isArray(subgraph.sources)) {
		for (const [name, filter] of Object.entries(
			subgraph.sources as Record<string, SubgraphFilter>,
		)) {
			filterLookup.set(name, filter);
		}
	}

	for (const { tx, events, sourceName } of matched) {
		const handler =
			subgraph.handlers[sourceName] ?? subgraph.handlers["*"] ?? null;
		if (!handler) {
			logger.warn("No handler found for source", {
				subgraph: subgraph.name,
				sourceName,
				txId: tx.tx_id,
			});
			continue;
		}

		ctx.setTx({
			txId: tx.tx_id,
			sender: tx.sender,
			type: tx.type,
			status: tx.status,
			contractId: tx.contract_id ?? null,
			functionName: tx.function_name ?? null,
		});

		const filter = filterLookup.get(sourceName);

		// If no events but tx matched, call handler with tx-level data
		if (events.length === 0) {
			try {
				const payload = filter
					? buildEventPayload(filter, tx, null)
					: {
							tx: {
								txId: tx.tx_id,
								sender: tx.sender,
								type: tx.type,
								status: tx.status,
								contractId: tx.contract_id,
								functionName: tx.function_name,
							},
						};
				await handler(payload, ctx);
				processed++;
			} catch (err) {
				errors++;
				logger.error("Subgraph handler error", {
					subgraph: subgraph.name,
					sourceName,
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
				const payload = filter
					? buildEventPayload(filter, tx, event)
					: (() => {
							const decoded = decodeEventData(event.data) as Record<
								string,
								unknown
							>;
							return {
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
						})();

				await handler(payload, ctx);
				processed++;
			} catch (err) {
				errors++;
				logger.error("Subgraph handler error", {
					subgraph: subgraph.name,
					sourceName,
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
