import { getErrorMessage } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import {
	clarityValueToJS,
	deserializeCV,
	toCamelCase,
} from "@secondlayer/stacks/clarity";
import type {
	ContractCallFilter,
	SubgraphDefinition,
	SubgraphFilter,
} from "../types.ts";
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
 *
 * postgres.js returns JSONB columns as JSON strings rather than parsed objects —
 * parse the string first before checking Array.isArray.
 */
function decodeFunctionArgs(args: unknown): unknown[] {
	let parsed = args;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.map((arg) => {
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
 * Build the named, ABI-decoded `event.input` for a contract_call source that
 * declares an `abi`. Each function arg is decoded via `clarityValueToJS` so the
 * values match the types `ExtractFunctionArgs` promises (Uint8Array buffers,
 * camelCase tuple keys, wrapped responses). Returns undefined when no abi /
 * function match, leaving handlers with the positional `args` only.
 */
export function buildContractCallInput(
	filter: ContractCallFilter,
	tx: MatchedTx["tx"],
): Record<string, unknown> | undefined {
	const abi = filter.abi;
	const fnName = tx.function_name;
	if (!abi || !fnName) return undefined;
	const fn = abi.functions?.find((f) => f.name === fnName);
	if (!fn || !Array.isArray(fn.args)) return undefined;

	let rawArgs: unknown = tx.function_args;
	if (typeof rawArgs === "string") {
		try {
			rawArgs = JSON.parse(rawArgs);
		} catch {
			return undefined;
		}
	}
	if (!Array.isArray(rawArgs)) return undefined;

	// Call through a non-generic cast: clarityValueToJS<T> instantiates the deep
	// AbiToTS<T> conditional (TS2589) at runtime call sites. The static types
	// come from ContractCallPayload; here we only need its runtime reshaping.
	const decodeArg = clarityValueToJS as unknown as (
		type: unknown,
		cv: unknown,
	) => unknown;
	const input: Record<string, unknown> = {};
	fn.args.forEach((arg, i) => {
		const hex = rawArgs[i];
		if (typeof hex !== "string") return;
		try {
			const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
			input[toCamelCase(arg.name)] = decodeArg(arg.type, deserializeCV(clean));
		} catch {
			// Skip args that fail to decode rather than dropping the whole event.
		}
	});
	return input;
}

/**
 * Build a typed event payload based on the source filter type.
 * Returns the payload the handler will receive.
 */
export function buildEventPayload(
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
			case "contract_call": {
				const input = buildContractCallInput(filter, tx);
				return {
					type: "contract_call",
					contractId: tx.contract_id ?? "",
					functionName: tx.function_name ?? "",
					sender: tx.sender,
					args: decodedArgs,
					...(input !== undefined ? { input } : {}),
					result: decodedResult,
					resultHex: tx.raw_result ?? null,
					tx: txMeta,
				};
			}
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
		// tokenId decodes from the canonical hex (`raw_value`), not the node's
		// verbose serde-tagged `value` (`{UInt:223}`). The hex is source-
		// independent — present in both the DB tap and the Index API — so a
		// subgraph yields the same clean tokenId (e.g. 223n) on either source.
		case "nft_transfer":
			return {
				sender: decoded.sender as string,
				recipient: decoded.recipient as string,
				tokenId: decoded.raw_value ?? decoded.value,
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "nft_mint":
			return {
				recipient: decoded.recipient as string,
				tokenId: decoded.raw_value ?? decoded.value,
				assetIdentifier: decoded.asset_identifier as string,
				tx: txMeta,
			};
		case "nft_burn":
			return {
				sender: decoded.sender as string,
				tokenId: decoded.raw_value ?? decoded.value,
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
			// Decode the print value from the canonical hex (`raw_value`) so it's
			// source-independent and clean — the node's verbose serde-tagged
			// `value` (e.g. `{Optional:{data:null}}`) is not reproducible from the
			// Index API and is no longer used (same rationale as nft tokenId).
			// decodeEventData skips hex ≤10 chars, so decode `raw_value` directly.
			const rawHex = (event.data as Record<string, unknown> | null)?.raw_value;
			const rawValue =
				typeof rawHex === "string" && rawHex.startsWith("0x")
					? decodeClarityValue(rawHex)
					: decoded.value;
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
		case "contract_call": {
			// Normalize the spread event Clarity `value` to the decoded canonical
			// (from `raw_value`), so it's identical whether the event came from the
			// DB tap or the Index API — the node's serde-tagged `value` is not
			// reproducible from Index (same rationale as nft tokenId / print).
			const ccRawHex = (event.data as Record<string, unknown> | null)
				?.raw_value;
			const normalized =
				typeof ccRawHex === "string" && ccRawHex.startsWith("0x")
					? { ...decoded, value: decodeClarityValue(ccRawHex) }
					: decoded;
			const input = buildContractCallInput(filter, tx);
			return {
				...normalized,
				type: "contract_call",
				_eventType: event.type,
				contractId: tx.contract_id ?? "",
				functionName: tx.function_name ?? "",
				sender: tx.sender,
				args: decodedArgs,
				...(input !== undefined ? { input } : {}),
				result: decodedResult,
				resultHex: tx.raw_result ?? null,
				tx: txMeta,
			};
		}

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

	// Flatten matches to per-event dispatch units and sort into CHAIN order
	// (tx_index, then event_index; tx-level matches first within their tx).
	// The matcher groups results by source, so without this a block's mints
	// all run before (or after) its transfers — a debit could apply before
	// the same block's funding credit, which on-chain ordering forbids. Chain
	// order makes per-statement invariants (e.g. uint CHECK >= 0) sound.
	type DispatchUnit = {
		tx: MatchedTx["tx"];
		sourceName: string;
		event: MatchedTx["events"][0] | null;
	};
	const units: DispatchUnit[] = [];
	for (const { tx, events, sourceName } of matched) {
		if (events.length === 0) {
			units.push({ tx, sourceName, event: null });
		} else {
			for (const event of events) units.push({ tx, sourceName, event });
		}
	}
	units.sort(
		(a, b) =>
			(a.tx.tx_index ?? 0) - (b.tx.tx_index ?? 0) ||
			(a.event?.event_index ?? -1) - (b.event?.event_index ?? -1),
	);

	for (const { tx, event, sourceName } of units) {
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

		// Checkpoint the ops queue: a handler that throws mid-way must
		// contribute nothing — a partial flush (e.g. a debit without its
		// credit) silently corrupts accumulator tables (fix-f040 B6).
		const checkpoint = ctx.opsCheckpoint();
		try {
			let payload: Record<string, unknown>;
			if (event === null) {
				// Tx-level match (contract_call / contract_deploy)
				payload = filter
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
			} else if (filter) {
				payload = buildEventPayload(filter, tx, event);
			} else {
				const decoded = decodeEventData(event.data) as Record<string, unknown>;
				payload = {
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
			}

			// Post-decode topic filter for print_event — source-matcher defers this
			// because data.value is raw hex at match time; apply it now after decode.
			if (
				event !== null &&
				filter?.type === "print_event" &&
				filter.topic &&
				payload.topic !== filter.topic
			) {
				continue;
			}

			await handler(payload, ctx);
			processed++;
		} catch (err) {
			ctx.rollbackTo(checkpoint);
			errors++;
			logger.error("Subgraph handler error", {
				subgraph: subgraph.name,
				sourceName,
				txId: tx.tx_id,
				...(event !== null ? { eventId: event.id, eventType: event.type } : {}),
				error: getErrorMessage(err),
			});
		}
	}

	return { processed, errors };
}
