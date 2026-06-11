import { getSourceDb } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { IndexHttpClient } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";
import { POX_CONTRACTS } from "@secondlayer/stacks/pox";
import { formatBtcAddress } from "@secondlayer/stacks/sbtc";
import type { Kysely } from "kysely";
import { createInternalIndexClient } from "../index-client.ts";
import {
	POX4_DECODER_NAME,
	type Pox4CallRow,
	writePox4Calls,
} from "../pox4-storage.ts";
import { readDecoderCheckpoint, writeDecoderCheckpoint } from "../storage.ts";

export { POX4_DECODER_NAME };

// Mainnet PoX cycle math constants (PoX genesis schedule from /v2/pox).
// Testnet skipped for v0; constants need verification before re-enabling.
const MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT = 666_050n;
const MAINNET_REWARD_CYCLE_LENGTH = 2_100n;

const MAINNET_POX4_CONTRACT = `${POX_CONTRACTS.mainnet.address}.${POX_CONTRACTS.mainnet.name}`;

const SUPPORTED_FUNCTIONS = new Set<Pox4FunctionName>([
	"stack-stx",
	"stack-extend",
	"stack-increase",
	"delegate-stx",
	"revoke-delegate-stx",
	"delegate-stack-stx",
	"delegate-stack-extend",
	"delegate-stack-increase",
	"stack-aggregation-commit",
	"stack-aggregation-commit-indexed",
	"stack-aggregation-increase",
	"set-signer-key-authorization",
]);

// Stacks height to anchor a fresh backfill. Default 0 = full history: the
// contract_id filter makes the Index API jump to the first pox-4 tx regardless,
// so 0 guarantees completeness; POX4_BACKFILL_FROM_HEIGHT only trims the scan.
const DEFAULT_POX4_BACKFILL_FROM_HEIGHT = 0;

function pox4BackfillFromHeight(override?: number): number {
	if (override !== undefined) return override;
	const env = process.env.POX4_BACKFILL_FROM_HEIGHT;
	const parsed = env !== undefined ? Number.parseInt(env, 10) : Number.NaN;
	return Number.isInteger(parsed) && parsed >= 0
		? parsed
		: DEFAULT_POX4_BACKFILL_FROM_HEIGHT;
}

export type ConsumePox4Options = {
	indexClient?: IndexHttpClient;
	targetDb?: Kysely<Database>;
	fromCursor?: string | null;
	backfillFromHeight?: number;
	batchSize?: number;
	maxPages?: number;
	signal?: AbortSignal;
	decoderName?: string;
	onProgress?: (stats: {
		decoded: number;
		cursor: string | null;
	}) => void | Promise<void>;
};

export type Pox4TxRow = {
	tx_id: string;
	block_height: number | string;
	tx_index: number | string;
	function_name: string;
	function_args: unknown;
	raw_result: string | null;
	sender: string;
	block_time: Date;
	burn_block_height: number | string;
};

export async function consumePox4DecodedEvents(
	opts: ConsumePox4Options = {},
): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const indexClient = opts.indexClient ?? createInternalIndexClient();
	const targetDb = opts.targetDb ?? getSourceDb();
	const decoderName = opts.decoderName ?? POX4_DECODER_NAME;
	const batchSize = opts.batchSize ?? 500;
	const maxPages = opts.maxPages ?? 50;
	const backfillFrom = pox4BackfillFromHeight(opts.backfillFromHeight);

	// Data-availability bound: never read past what the Index plane can serve,
	// even if the Streams clock is ahead. Captured once per call.
	const toHeight = await indexClient.getIndexTip();
	if (toHeight <= 0) {
		logger.warn("PoX-4 decoder: Index tip unavailable; skipping tick");
		return { cursor: null, pages: 0, decoded: 0 };
	}

	let cursor: string | null;
	if (opts.fromCursor !== undefined) {
		cursor = opts.fromCursor;
	} else {
		cursor = await readDecoderCheckpoint({ db: targetDb, decoderName });
		// On restart bump updated_at so health reports `checkpoint_recent` before
		// the first tick. A null checkpoint means a fresh backfill — the first
		// fetch anchors at `backfillFrom` via from_height (no pre-seed).
		if (cursor !== null) {
			await writeDecoderCheckpoint({ db: targetDb, decoderName, cursor });
		}
	}

	let pages = 0;
	let decoded = 0;

	while (pages < maxPages) {
		if (opts.signal?.aborted) break;

		const rows = await fetchTxBatch(
			indexClient,
			cursor,
			batchSize,
			toHeight,
			backfillFrom,
		);
		if (rows.length === 0) {
			// Caught up to the Index tip with no pox-4 txs in range. Advance the
			// checkpoint to the tip so health sees a recent checkpoint — otherwise
			// the decoder looks stale during the long quiet windows between cycle
			// prep events — and the next run resumes after the tip.
			// int4 max — tx_index is a Postgres `integer`; a larger sentinel
			// overflows when this cursor is used in the transactions `after` query.
			const tipCursor = encodePox4Cursor(toHeight, 2_147_483_647);
			if (tipCursor !== cursor) cursor = tipCursor;
			await writeDecoderCheckpoint({ db: targetDb, decoderName, cursor });
			break;
		}

		const decodedRows: Pox4CallRow[] = [];
		for (const row of rows) {
			try {
				const decodedRow = decodePox4Tx(row);
				if (decodedRow) decodedRows.push(decodedRow);
			} catch (err) {
				logger.warn("PoX-4 decoder: failed to decode tx", {
					tx_id: row.tx_id,
					error: err instanceof Error ? err.message : err,
				});
			}
		}

		if (decodedRows.length > 0) {
			await writePox4Calls(decodedRows, { db: targetDb });
			decoded += decodedRows.length;
		}

		const last = rows[rows.length - 1];
		if (!last) break;
		cursor = encodePox4Cursor(Number(last.block_height), Number(last.tx_index));

		await writeDecoderCheckpoint({ db: targetDb, decoderName, cursor });
		pages += 1;

		await opts.onProgress?.({ decoded, cursor });

		if (rows.length < batchSize) break;
	}

	return { cursor, pages, decoded };
}

// Source one batch of pox-4 contract-call txs over the public Index API in a
// single request. /v1/index/transactions serves block_time + burn_block_height
// inline (alongside function_args_hex/result_hex/sender), so no per-batch block
// join is needed — backfill stays one request per page.
async function fetchTxBatch(
	indexClient: IndexHttpClient,
	cursor: string | null,
	batchSize: number,
	toHeight: number,
	backfillFrom: number,
): Promise<Pox4TxRow[]> {
	const { transactions } = await indexClient.fetchContractCalls(
		MAINNET_POX4_CONTRACT,
		{
			toHeight,
			cursor: cursor ?? undefined,
			fromHeight: cursor ? undefined : backfillFrom,
			limit: batchSize,
		},
	);
	return transactions.map((t) => ({
		tx_id: t.tx_id,
		block_height: t.block_height,
		tx_index: t.tx_index,
		function_name: t.contract_call?.function_name ?? "",
		// function_args_hex is an array of Clarity hex (NOT the decoded args);
		// parseFunctionArgs deserializes each hex.
		function_args: t.contract_call?.function_args_hex ?? null,
		// result_hex is the raw Clarity result; parseResultOk deserializes it.
		raw_result: t.contract_call?.result_hex ?? null,
		sender: t.sender,
		block_time: coerceBlockTime(t.block_time),
		burn_block_height: Number(t.burn_block_height ?? 0),
	}));
}

// Index API serves block_time as an ISO-8601 string; the legacy DB path served
// bigint epoch-seconds (pg returns bigint as a digit string). Handle both: a
// pure-digit string is epoch-seconds, anything else is an ISO timestamp.
export function coerceBlockTime(value: unknown): Date {
	if (typeof value === "string" && !/^\d+$/.test(value)) {
		return new Date(value);
	}
	if (value instanceof Date) return value;
	const seconds = Number(value);
	return new Date(seconds * 1000);
}

export function encodePox4Cursor(blockHeight: number, txIndex: number): string {
	return `${blockHeight}:${txIndex}`;
}

export function decodePox4Cursor(cursor: string): {
	blockHeight: number;
	txIndex: number;
} {
	const parts = cursor.split(":");
	if (parts.length !== 2) throw new Error(`invalid pox-4 cursor: ${cursor}`);
	// biome-ignore lint/style/noNonNullAssertion: length checked above
	const blockHeight = Number.parseInt(parts[0]!, 10);
	// biome-ignore lint/style/noNonNullAssertion: length checked above
	const txIndex = Number.parseInt(parts[1]!, 10);
	if (!Number.isInteger(blockHeight) || !Number.isInteger(txIndex)) {
		throw new Error(`invalid pox-4 cursor: ${cursor}`);
	}
	return { blockHeight, txIndex };
}

// ── Decode dispatch ─────────────────────────────────────────────────────────

export function decodePox4Tx(row: Pox4TxRow): Pox4CallRow | null {
	const fnName = row.function_name as Pox4FunctionName;
	if (!SUPPORTED_FUNCTIONS.has(fnName)) return null;

	const args = parseFunctionArgs(row.function_args);
	const resultOk = parseResultOk(row.raw_result);
	const blockHeight = Number(row.block_height);
	const txIndex = Number(row.tx_index);
	const cursor = encodePox4Cursor(blockHeight, txIndex);

	const base: Pox4CallRow = {
		cursor,
		block_height: blockHeight,
		block_time: row.block_time,
		burn_block_height: Number(row.burn_block_height),
		tx_id: row.tx_id,
		tx_index: txIndex,
		function_name: fnName,
		caller: row.sender,
		stacker: null,
		delegate_to: null,
		amount_ustx: null,
		lock_period: null,
		pox_addr_version: null,
		pox_addr_hashbytes: null,
		pox_addr_btc: null,
		start_cycle: null,
		end_cycle: null,
		signer_key: null,
		signer_signature: null,
		auth_id: null,
		max_amount: null,
		reward_cycle: null,
		aggregated_amount_ustx: null,
		aggregated_signer_index: null,
		auth_period: null,
		auth_topic: null,
		auth_allowed: null,
		result_ok: resultOk,
		result_raw: row.raw_result ?? "",
		source_cursor: cursor,
	};

	// On failed calls, only base fields land. result_raw + result_ok=false.
	if (!resultOk) return base;

	switch (fnName) {
		case "stack-stx":
			return { ...base, ...decodeStackStx(args) };
		case "stack-extend":
			return { ...base, ...decodeStackExtend(args) };
		case "stack-increase":
			return { ...base, ...decodeStackIncrease(args) };
		case "delegate-stx":
			return { ...base, ...decodeDelegateStx(args) };
		case "revoke-delegate-stx":
			return { ...base, stacker: row.sender };
		case "delegate-stack-stx":
			return { ...base, ...decodeDelegateStackStx(args) };
		case "delegate-stack-extend":
			return { ...base, ...decodeDelegateStackExtend(args) };
		case "delegate-stack-increase":
			return { ...base, ...decodeDelegateStackIncrease(args) };
		case "stack-aggregation-commit":
			return {
				...base,
				...decodeAggregationCommit(args, row.raw_result, false),
			};
		case "stack-aggregation-commit-indexed":
			return {
				...base,
				...decodeAggregationCommit(args, row.raw_result, true),
			};
		case "stack-aggregation-increase":
			return { ...base, ...decodeAggregationIncrease(args) };
		case "set-signer-key-authorization":
			return { ...base, ...decodeSetSignerKeyAuthorization(args) };
		default:
			return base;
	}
}

// ── Per-function decoders (solo + delegate) ─────────────────────────────────

function decodeStackStx(args: unknown[]): Partial<Pox4CallRow> {
	const [
		amountUstx,
		poxAddr,
		startBurnHt,
		lockPeriod,
		signerSig,
		signerKey,
		maxAmount,
		authId,
	] = args;
	const lockPeriodNum = asInt32(lockPeriod);
	const startBurnHtBig = asBigInt(startBurnHt);
	const startCycle =
		startBurnHtBig !== null
			? Number(burnHeightToRewardCycleMainnet(startBurnHtBig))
			: null;
	const endCycle =
		startCycle !== null && lockPeriodNum !== null
			? startCycle + lockPeriodNum - 1
			: null;
	const pox = decodePoxAddr(poxAddr);
	return {
		stacker: null, // stacker = caller, set by caller field
		amount_ustx: asDecimal(amountUstx),
		lock_period: lockPeriodNum,
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		start_cycle: startCycle,
		end_cycle: endCycle,
		signer_key: asHex(signerKey),
		signer_signature: asOptionalHex(signerSig),
		auth_id: asDecimal(authId),
		max_amount: asDecimal(maxAmount),
	};
}

function decodeStackExtend(args: unknown[]): Partial<Pox4CallRow> {
	const [extendCount, poxAddr, signerSig, signerKey, maxAmount, authId] = args;
	const pox = decodePoxAddr(poxAddr);
	return {
		lock_period: asInt32(extendCount),
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		signer_key: asHex(signerKey),
		signer_signature: asOptionalHex(signerSig),
		max_amount: asDecimal(maxAmount),
		auth_id: asDecimal(authId),
	};
}

function decodeStackIncrease(args: unknown[]): Partial<Pox4CallRow> {
	const [increaseBy, signerSig, signerKey, maxAmount, authId] = args;
	return {
		amount_ustx: asDecimal(increaseBy),
		signer_key: asHex(signerKey),
		signer_signature: asOptionalHex(signerSig),
		max_amount: asDecimal(maxAmount),
		auth_id: asDecimal(authId),
	};
}

function decodeDelegateStx(args: unknown[]): Partial<Pox4CallRow> {
	const [amountUstx, delegateTo, _untilBurnHt, poxAddrOpt] = args;
	const pox = decodePoxAddrOptional(poxAddrOpt);
	return {
		delegate_to: asString(delegateTo),
		amount_ustx: asDecimal(amountUstx),
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
	};
}

function decodeDelegateStackStx(args: unknown[]): Partial<Pox4CallRow> {
	const [stacker, amountUstx, poxAddr, startBurnHt, lockPeriod] = args;
	const lockPeriodNum = asInt32(lockPeriod);
	const startBurnHtBig = asBigInt(startBurnHt);
	const startCycle =
		startBurnHtBig !== null
			? Number(burnHeightToRewardCycleMainnet(startBurnHtBig))
			: null;
	const endCycle =
		startCycle !== null && lockPeriodNum !== null
			? startCycle + lockPeriodNum - 1
			: null;
	const pox = decodePoxAddr(poxAddr);
	return {
		stacker: asString(stacker),
		amount_ustx: asDecimal(amountUstx),
		lock_period: lockPeriodNum,
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		start_cycle: startCycle,
		end_cycle: endCycle,
	};
}

function decodeDelegateStackExtend(args: unknown[]): Partial<Pox4CallRow> {
	const [stacker, poxAddr, extendCount] = args;
	const pox = decodePoxAddr(poxAddr);
	return {
		stacker: asString(stacker),
		lock_period: asInt32(extendCount),
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
	};
}

function decodeDelegateStackIncrease(args: unknown[]): Partial<Pox4CallRow> {
	const [stacker, poxAddr, increaseBy] = args;
	const pox = decodePoxAddr(poxAddr);
	return {
		stacker: asString(stacker),
		amount_ustx: asDecimal(increaseBy),
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
	};
}

// ── Per-function decoders (aggregation + signer-auth) ───────────────────────

function decodeAggregationCommit(
	args: unknown[],
	rawResult: string | null,
	indexed: boolean,
): Partial<Pox4CallRow> {
	const [poxAddr, rewardCycle, signerSig, signerKey, maxAmount, authId] = args;
	const pox = decodePoxAddr(poxAddr);
	const okValue = parseResultOkValue(rawResult);
	// `commit-indexed` returns `(ok uint)` with the signer slot index. `commit`
	// returns `(ok bool)` per contract source; some envs may return `(ok uint)`
	// with the aggregated amount — store opportunistically.
	const indexAsBig = asBigInt(okValue);
	return {
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		reward_cycle: asInt32(rewardCycle),
		signer_key: asHex(signerKey),
		signer_signature: asOptionalHex(signerSig),
		max_amount: asDecimal(maxAmount),
		auth_id: asDecimal(authId),
		aggregated_signer_index:
			indexed && indexAsBig !== null ? Number(indexAsBig) : null,
		aggregated_amount_ustx: !indexed ? asDecimal(okValue) : null,
	};
}

function decodeAggregationIncrease(args: unknown[]): Partial<Pox4CallRow> {
	const [
		poxAddr,
		rewardCycle,
		increaseBy,
		signerKey,
		signerSig,
		maxAmount,
		authId,
	] = args;
	const pox = decodePoxAddr(poxAddr);
	return {
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		reward_cycle: asInt32(rewardCycle),
		amount_ustx: asDecimal(increaseBy),
		signer_key: asHex(signerKey),
		signer_signature: asOptionalHex(signerSig),
		max_amount: asDecimal(maxAmount),
		auth_id: asDecimal(authId),
	};
}

function decodeSetSignerKeyAuthorization(
	args: unknown[],
): Partial<Pox4CallRow> {
	const [
		poxAddr,
		period,
		rewardCycle,
		topic,
		signerKey,
		allowed,
		maxAmount,
		authId,
	] = args;
	const pox = decodePoxAddr(poxAddr);
	return {
		pox_addr_version: pox?.version ?? null,
		pox_addr_hashbytes: pox?.hashbytes ?? null,
		pox_addr_btc: pox?.btc ?? null,
		auth_period: asInt32(period),
		reward_cycle: asInt32(rewardCycle),
		auth_topic: asString(topic),
		signer_key: asHex(signerKey),
		auth_allowed: typeof allowed === "boolean" ? allowed : null,
		max_amount: asDecimal(maxAmount),
		auth_id: asDecimal(authId),
	};
}

/** Returns the unwrapped value inside `(ok ...)`, or null on err / no result. */
function parseResultOkValue(stored: string | null): unknown {
	if (!stored) return null;
	const cleanHex = stored.startsWith("0x") ? stored.slice(2) : stored;
	const cv = deserializeCV(cleanHex);
	if (cv.type !== "ok") return null;
	return cvToValue(cv);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseFunctionArgs(stored: unknown): unknown[] {
	if (stored === null || stored === undefined) return [];
	const hexes: string[] =
		typeof stored === "string" ? JSON.parse(stored) : (stored as string[]);
	return hexes.map((hex) => decodeClarityHex(hex));
}

/**
 * cvToValue strips `(ok ...)` / `(err ...)` wrappers, so to determine
 * whether a call succeeded we deserialize the raw result and read its
 * top-level type tag. Returns true for ok, false for err. Treats missing
 * result as ok=false (failed/no-result).
 */
function parseResultOk(stored: string | null): boolean {
	if (!stored) return false;
	const cleanHex = stored.startsWith("0x") ? stored.slice(2) : stored;
	const cv = deserializeCV(cleanHex);
	return cv.type === "ok";
}

function decodeClarityHex(hex: string): unknown {
	const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
	const cv = deserializeCV(cleanHex);
	return cvToValue(cv);
}

type PoxAddrDecoded = {
	version: number;
	hashbytes: string;
	btc: string | null;
};

function decodePoxAddr(value: unknown): PoxAddrDecoded | null {
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	const version = asInt32FromBuff(obj.version);
	const hashbytes = asHex(obj.hashbytes);
	if (version === null || !hashbytes) return null;
	let btc: string | null = null;
	try {
		const hb = hexToBytesPacked(hashbytes);
		btc = formatBtcAddress({ version, hashbytes: hb });
	} catch {
		btc = null;
	}
	return { version, hashbytes, btc };
}

function decodePoxAddrOptional(value: unknown): PoxAddrDecoded | null {
	// cvToValue unwraps `(some x)` to x and `none` to null.
	if (value === null || value === undefined) return null;
	return decodePoxAddr(value);
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asHex(value: unknown): string | null {
	if (typeof value === "string") {
		return value.startsWith("0x") ? value : `0x${value}`;
	}
	if (value instanceof Uint8Array) {
		return `0x${bytesToHex(value)}`;
	}
	return null;
}

function asOptionalHex(value: unknown): string | null {
	// cvToValue unwraps `(some buff)` to the buff and `none` to null.
	if (value === null || value === undefined) return null;
	return asHex(value);
}

function asInt32FromBuff(value: unknown): number | null {
	const hex = asHex(value);
	if (!hex) return null;
	const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (stripped.length === 0) return null;
	return Number.parseInt(stripped.slice(0, 2), 16);
}

function asBigInt(value: unknown): bigint | null {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	return null;
}

function asInt32(value: unknown): number | null {
	const big = asBigInt(value);
	if (big === null) return null;
	if (big > 2_147_483_647n || big < -2_147_483_648n) {
		throw new Error(`int32 overflow: ${big.toString()}`);
	}
	return Number(big);
}

function asDecimal(value: unknown): string | null {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string") return value;
	return null;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytesPacked(hex: string): Uint8Array {
	const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
	const out = new Uint8Array(stripped.length / 2);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function burnHeightToRewardCycleMainnet(burnHeight: bigint): bigint {
	return (
		(burnHeight - MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT) /
		MAINNET_REWARD_CYCLE_LENGTH
	);
}
