#!/usr/bin/env bun
/**
 * Transaction data repair script
 *
 * Repairs missing function_args and raw_result for contract_call transactions.
 * Strategy:
 * 1. Try to re-decode existing raw_tx to extract function_args
 * 2. Fall back to Hiro API for missing data (with rate limiting)
 *
 * Usage:
 *   HIRO_API_KEY=xxx bun run packages/indexer/src/repair-transactions.ts
 *
 * Environment:
 *   DATABASE_URL - Postgres connection (required)
 *   HIRO_API_KEY - Hiro API key for higher rate limits (required)
 *   REPAIR_FROM - Start block (default: 1)
 *   REPAIR_TO - End block (default: auto-detect from DB)
 *   REPAIR_BATCH_SIZE - Blocks per batch (default: 10, use 1-5 for very conservative)
 *   REPAIR_TX_CONCURRENCY - Max concurrent Hiro API calls (default: 3)
 *   REPAIR_DRY_RUN - Log only, no DB updates (default: false)
 *   REPAIR_TEST_BLOCKS - Number of blocks for test run (default: 100)
 *   REPAIR_RESUME_FILE - Progress tracking file (default: repair-progress.json)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { serializeCV } from "@secondlayer/stacks/clarity";
import type { ClarityValue } from "@secondlayer/stacks/clarity";
import {
	PayloadType,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";

// --- Config ---
const HIRO_API_KEY = process.env.HIRO_API_KEY;
if (!HIRO_API_KEY) {
	throw new Error("HIRO_API_KEY environment variable is required");
}

const REPAIR_FROM = Number.parseInt(process.env.REPAIR_FROM || "1");
const REPAIR_TO = Number.parseInt(process.env.REPAIR_TO || "0"); // 0 = auto-detect
const BATCH_SIZE = Number.parseInt(process.env.REPAIR_BATCH_SIZE || "10");
const TX_CONCURRENCY = Number.parseInt(
	process.env.REPAIR_TX_CONCURRENCY || "3",
);
const DRY_RUN = process.env.REPAIR_DRY_RUN === "true";
const TEST_BLOCKS = Number.parseInt(process.env.REPAIR_TEST_BLOCKS || "100");
const RESUME_FILE = process.env.REPAIR_RESUME_FILE || "repair-progress.json";

// Rate limiting: min ms between API calls (with API key, Hiro allows ~50 req/sec)
// We use 100ms = 10 req/sec to be conservative
const HIRO_RATE_LIMIT_MS = 100;

// Exponential backoff for 429s
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

// --- Types ---
interface RepairTx {
	tx_id: string;
	block_height: number;
	tx_index: number;
	raw_tx: string;
	raw_result: string | null;
	function_args: string | null;
	type: string;
	contract_id: string | null;
	function_name: string | null;
}

interface RepairProgress {
	lastBlockHeight: number;
	blocksProcessed: number;
	txsRepaired: number;
	apiCalls: number;
	startedAt: string;
	updatedAt: string;
	completed: boolean;
}

// --- Hiro API Client ---
class HiroRepairClient {
	private lastCallTime = 0;
	private apiCalls = 0;

	private async rateLimit(): Promise<void> {
		const now = Date.now();
		const elapsed = now - this.lastCallTime;
		if (elapsed < HIRO_RATE_LIMIT_MS) {
			await new Promise((r) => setTimeout(r, HIRO_RATE_LIMIT_MS - elapsed));
		}
		this.lastCallTime = Date.now();
		this.apiCalls++;
	}

	private getHeaders(): Record<string, string> {
		if (!HIRO_API_KEY) return {};
		return {
			"x-hiro-api-key": HIRO_API_KEY,
		};
	}

	private async fetchWithRetry(
		url: string,
		retries = MAX_RETRIES,
		backoff = INITIAL_BACKOFF_MS,
	): Promise<Response> {
		await this.rateLimit();

		try {
			const res = await fetch(url, {
				headers: this.getHeaders(),
				signal: AbortSignal.timeout(30000),
			});

			if (res.status === 429 && retries > 0) {
				logger.warn("Rate limited, backing off", { url, backoff });
				await new Promise((r) => setTimeout(r, backoff));
				return this.fetchWithRetry(url, retries - 1, backoff * 2);
			}

			return res;
		} catch (error) {
			if (retries > 0) {
				logger.warn("Fetch failed, retrying", {
					url,
					error: String(error),
					retries,
				});
				await new Promise((r) => setTimeout(r, backoff));
				return this.fetchWithRetry(url, retries - 1, backoff * 2);
			}
			throw error;
		}
	}

	async fetchTxDetails(txId: string): Promise<{
		raw_result?: string;
		function_args?: string[];
		contract_id?: string;
		function_name?: string;
	} | null> {
		const url = `https://api.mainnet.hiro.so/extended/v1/tx/${txId}`;
		const res = await this.fetchWithRetry(url);

		if (!res.ok) {
			logger.warn("Failed to fetch tx from Hiro", { txId, status: res.status });
			return null;
		}

		const data = (await res.json()) as {
			tx_id: string;
			tx_status: string;
			tx_result?: { hex: string };
			contract_call?: {
				contract_id?: string;
				function_name?: string;
				function_args?: Array<{ hex: string; repr: string }>;
			};
			smart_contract?: { contract_id?: string };
		};

		const result: {
			raw_result?: string;
			function_args?: string[];
			contract_id?: string;
			function_name?: string;
		} = {};

		if (data.tx_result?.hex) {
			result.raw_result = data.tx_result.hex;
		}

		if (
			data.contract_call?.function_args &&
			Array.isArray(data.contract_call.function_args)
		) {
			result.function_args = data.contract_call.function_args.map(
				(arg) => arg.hex,
			);
		}

		if (data.contract_call?.contract_id) {
			result.contract_id = data.contract_call.contract_id;
		}
		if (data.contract_call?.function_name) {
			result.function_name = data.contract_call.function_name;
		}
		if (data.smart_contract?.contract_id) {
			result.contract_id = data.smart_contract.contract_id;
		}

		return result;
	}

	async fetchRawTx(txId: string): Promise<string | null> {
		const url = `https://api.mainnet.hiro.so/extended/v1/tx/${txId}/raw`;
		const res = await this.fetchWithRetry(url);

		if (!res.ok) return null;

		const data = (await res.json()) as { raw_tx?: string };
		return data.raw_tx || null;
	}

	getApiCallCount(): number {
		return this.apiCalls;
	}
}

// --- Raw Tx Decoder ---
function decodeRawTx(
	rawTx: string,
	txid: string,
): { functionArgs: string[] | null } | null {
	try {
		const tx = deserializeTransaction(rawTx);

		if (tx.payload.payloadType === PayloadType.ContractCall) {
			const payload = tx.payload as {
				functionArgs: unknown[];
			};
			const functionArgs =
				payload.functionArgs?.map((cv) => serializeCV(cv as ClarityValue)) ??
				null;
			return { functionArgs };
		}

		return null;
	} catch (error) {
		logger.debug("Failed to decode raw_tx", {
			txid,
			error: String(error).split("\n")[0],
		});
		return null;
	}
}

// --- Repair Logic ---
async function repairTransaction(
	tx: RepairTx,
	hiroClient: HiroRepairClient,
): Promise<{
	functionArgs: string[] | null;
	rawResult: string | null;
	contractId: string | null;
	functionName: string | null;
	source: "decode" | "api" | "none";
}> {
	let functionArgs: string[] | null = null;
	let rawResult: string | null = null;
	let contractId: string | null = null;
	let functionName: string | null = null;
	let source: "decode" | "api" | "none" = "none";

	// 1. Try to decode function_args from raw_tx if missing
	if (!tx.function_args && tx.raw_tx && tx.raw_tx.length > 10) {
		const decoded = decodeRawTx(tx.raw_tx, tx.tx_id);
		if (decoded?.functionArgs) {
			functionArgs = decoded.functionArgs;
			source = "decode";
			logger.debug("Decoded function_args from raw_tx", { txId: tx.tx_id });
		}
	}

	// 2. If still missing function_args, raw_result, or contract_id, fetch from Hiro API
	if (!functionArgs || !tx.raw_result || !tx.contract_id) {
		const apiData = await hiroClient.fetchTxDetails(tx.tx_id);

		if (apiData) {
			if (!functionArgs && apiData.function_args) {
				functionArgs = apiData.function_args;
			}
			if (!tx.raw_result && apiData.raw_result) {
				rawResult = apiData.raw_result;
			}
			if (!tx.contract_id && apiData.contract_id) {
				contractId = apiData.contract_id;
			}
			if (!tx.function_name && apiData.function_name) {
				functionName = apiData.function_name;
			}

			if (
				source === "none" &&
				(functionArgs || rawResult || contractId || functionName)
			) {
				source = "api";
			}

			logger.debug("Fetched missing data from Hiro API", {
				txId: tx.tx_id,
				gotFunctionArgs: !!apiData.function_args,
				gotRawResult: !!apiData.raw_result,
				gotContractId: !!apiData.contract_id,
				gotFunctionName: !!apiData.function_name,
			});
		}
	}

	return { functionArgs, rawResult, contractId, functionName, source };
}

// --- Progress Management ---
function loadProgress(): RepairProgress | null {
	if (!existsSync(RESUME_FILE)) return null;
	try {
		return JSON.parse(readFileSync(RESUME_FILE, "utf-8"));
	} catch {
		return null;
	}
}

function saveProgress(progress: RepairProgress) {
	progress.updatedAt = new Date().toISOString();
	writeFileSync(RESUME_FILE, JSON.stringify(progress, null, 2));
}

// --- Main ---
async function main() {
	logger.info("Transaction repair starting", {
		repairFrom: REPAIR_FROM,
		repairTo: REPAIR_TO || "auto",
		batchSize: BATCH_SIZE,
		txConcurrency: TX_CONCURRENCY,
		dryRun: DRY_RUN,
		testBlocks: TEST_BLOCKS,
	});

	const db = getDb();
	const hiroClient = new HiroRepairClient();

	// Determine target height
	let targetHeight = REPAIR_TO;
	if (targetHeight === 0) {
		const { rows } = await sql<{ max_height: string }>`
			SELECT COALESCE(MAX(block_height), 0) as max_height FROM transactions WHERE type = 'contract_call'
		`.execute(db);
		targetHeight = Number(rows[0]?.max_height ?? 0);
		logger.info("Auto-detected max block height", { targetHeight });
	}

	// Determine start height (resume or fresh)
	const progress = loadProgress();
	const startHeight =
		progress?.lastBlockHeight && progress.lastBlockHeight >= REPAIR_FROM
			? progress.lastBlockHeight + 1
			: REPAIR_FROM;

	if (progress) {
		logger.info("Resuming from previous progress", {
			lastBlock: progress.lastBlockHeight,
			blocksProcessed: progress.blocksProcessed,
			txsRepaired: progress.txsRepaired,
		});
	}

	// Limit to test blocks for initial run
	const endHeight = Math.min(startHeight + TEST_BLOCKS - 1, targetHeight);
	logger.info("Test run limited to blocks", {
		from: startHeight,
		to: endHeight,
		count: endHeight - startHeight + 1,
	});

	const repairState: RepairProgress = progress || {
		lastBlockHeight: startHeight - 1,
		blocksProcessed: 0,
		txsRepaired: 0,
		apiCalls: 0,
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		completed: false,
	};

	let totalTxsFound = 0;
	let totalTxsRepaired = 0;

	// Process blocks in batches
	for (
		let batchStart = startHeight;
		batchStart <= endHeight;
		batchStart += BATCH_SIZE
	) {
		const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, endHeight);

		logger.info("Processing batch", { from: batchStart, to: batchEnd });

		// Phase 1: contract_call rows missing function_args or raw_result
		const phase1 = await db
			.selectFrom("transactions")
			.select([
				"tx_id",
				"block_height",
				"tx_index",
				"raw_tx",
				"raw_result",
				"function_args",
				"type",
				"contract_id",
				"function_name",
			])
			.where("block_height", ">=", batchStart)
			.where("block_height", "<=", batchEnd)
			.where((eb) =>
				eb.or([
					eb("type", "=", "contract_call"),
					eb("type", "=", "smart_contract"),
				]),
			)
			.where((eb) =>
				eb.or([eb("function_args", "is", null), eb("raw_result", "is", null)]),
			)
			.orderBy("block_height", "asc")
			.orderBy("tx_index", "asc")
			.execute();

		// Phase 2: contract_call or smart_contract rows missing contract_id
		const phase2 = await db
			.selectFrom("transactions")
			.select([
				"tx_id",
				"block_height",
				"tx_index",
				"raw_tx",
				"raw_result",
				"function_args",
				"type",
				"contract_id",
				"function_name",
			])
			.where("block_height", ">=", batchStart)
			.where("block_height", "<=", batchEnd)
			.where((eb) =>
				eb.or([
					eb("type", "=", "contract_call"),
					eb("type", "=", "smart_contract"),
				]),
			)
			.where("contract_id", "is", null)
			.orderBy("block_height", "asc")
			.orderBy("tx_index", "asc")
			.execute();

		// Merge, deduplicating by tx_id
		const seenIds = new Set(phase1.map((t) => t.tx_id));
		const txsToRepair = [
			...phase1,
			...phase2.filter((t) => !seenIds.has(t.tx_id)),
		];

		if (txsToRepair.length === 0) {
			logger.info("No repairs needed in batch", {
				from: batchStart,
				to: batchEnd,
			});
			repairState.lastBlockHeight = batchEnd;
			repairState.blocksProcessed += batchEnd - batchStart + 1;
			saveProgress(repairState);
			continue;
		}

		totalTxsFound += txsToRepair.length;
		logger.info("Found transactions needing repair", {
			count: txsToRepair.length,
			batchFrom: batchStart,
			batchTo: batchEnd,
		});

		// Process with bounded concurrency
		const repaired: Array<{
			tx_id: string;
			function_args: string[] | null;
			raw_result: string | null;
			contract_id: string | null;
			function_name: string | null;
			source: string;
		}> = [];

		for (let i = 0; i < txsToRepair.length; i += TX_CONCURRENCY) {
			const chunk = txsToRepair.slice(i, i + TX_CONCURRENCY);
			const chunkResults = await Promise.all(
				chunk.map(async (tx) => {
					const typedTx: RepairTx = {
						tx_id: tx.tx_id as string,
						block_height: tx.block_height as number,
						tx_index: tx.tx_index as number,
						raw_tx: tx.raw_tx as string,
						raw_result: tx.raw_result as string | null,
						function_args: tx.function_args as string | null,
						type: tx.type as string,
						contract_id: tx.contract_id as string | null,
						function_name: tx.function_name as string | null,
					};
					const result = await repairTransaction(typedTx, hiroClient);
					return {
						tx_id: typedTx.tx_id,
						function_args: result.functionArgs,
						raw_result: result.rawResult,
						contract_id: result.contractId,
						function_name: result.functionName,
						source: result.source,
					};
				}),
			);
			repaired.push(...chunkResults);

			// Progress logging
			const chunkRepaired = chunkResults.filter(
				(r) =>
					r.function_args || r.raw_result || r.contract_id || r.function_name,
			).length;
			logger.debug("Processed chunk", {
				chunkSize: chunk.length,
				repaired: chunkRepaired,
				apiCalls: hiroClient.getApiCallCount(),
			});
		}

		// Apply repairs to DB (unless dry run)
		let batchRepaired = 0;
		if (!DRY_RUN) {
			for (const repair of repaired) {
				if (
					!repair.function_args &&
					!repair.raw_result &&
					!repair.contract_id &&
					!repair.function_name
				)
					continue;

				const updateData: {
					function_args?: string;
					raw_result?: string;
					contract_id?: string;
					function_name?: string;
				} = {};
				if (repair.function_args) {
					updateData.function_args = JSON.stringify(repair.function_args);
				}
				if (repair.raw_result) {
					updateData.raw_result = repair.raw_result;
				}
				if (repair.contract_id) {
					updateData.contract_id = repair.contract_id;
				}
				if (repair.function_name) {
					updateData.function_name = repair.function_name;
				}

				await db
					.updateTable("transactions")
					.set(updateData)
					.where("tx_id", "=", repair.tx_id)
					.execute();

				batchRepaired++;
				logger.debug("Repaired transaction", {
					txId: repair.tx_id,
					source: repair.source,
					functionArgs: !!repair.function_args,
					rawResult: !!repair.raw_result,
					contractId: !!repair.contract_id,
					functionName: !!repair.function_name,
				});
			}
		} else {
			batchRepaired = repaired.filter(
				(r) =>
					r.function_args || r.raw_result || r.contract_id || r.function_name,
			).length;
			logger.info("Dry run - would repair", {
				count: batchRepaired,
				sample: repaired.slice(0, 3).map((r) => ({
					txId: `${r.tx_id.slice(0, 16)}...`,
					source: r.source,
				})),
			});
		}

		totalTxsRepaired += batchRepaired;
		repairState.lastBlockHeight = batchEnd;
		repairState.blocksProcessed += batchEnd - batchStart + 1;
		repairState.txsRepaired += batchRepaired;
		repairState.apiCalls = hiroClient.getApiCallCount();
		saveProgress(repairState);

		logger.info("Batch complete", {
			from: batchStart,
			to: batchEnd,
			processed: txsToRepair.length,
			repaired: batchRepaired,
			totalRepaired: totalTxsRepaired,
			apiCalls: hiroClient.getApiCallCount(),
		});

		// Extra sleep between batches to be extra conservative
		if (!DRY_RUN) {
			await new Promise((r) => setTimeout(r, 500));
		}
	}

	repairState.completed = true;
	saveProgress(repairState);

	logger.info("Test repair complete", {
		blocksProcessed: repairState.blocksProcessed,
		totalTxsFound,
		totalTxsRepaired,
		totalApiCalls: hiroClient.getApiCallCount(),
		dryRun: DRY_RUN,
	});

	await closeDb();
}

main().catch((err) => {
	logger.error("Repair script fatal error", { error: err });
	process.exit(1);
});
