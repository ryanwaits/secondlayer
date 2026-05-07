import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { STREAMS_BLOCKS_PER_DAY } from "../../streams/tiers.ts";

// ── Shared parsing helpers ─────────────────────────────────────────

function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 200;
	const parsed = parseNonNegativeInteger(value, "limit");
	return Math.min(1000, Math.max(1, parsed));
}

function parseFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	return value;
}

function parsePox4Cursor(value: string): {
	block_height: number;
	tx_index: number;
} {
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
	if (!match) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	const blockHeight = Number(match[1]);
	const txIndex = Number(match[2]);
	if (!Number.isSafeInteger(blockHeight) || !Number.isSafeInteger(txIndex)) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	return { block_height: blockHeight, tx_index: txIndex };
}

const VALID_FUNCTION_NAMES = new Set<Pox4FunctionName>([
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

function parseFunctionName(
	value: string | undefined,
): Pox4FunctionName | undefined {
	if (value === undefined) return undefined;
	if (!VALID_FUNCTION_NAMES.has(value as Pox4FunctionName)) {
		throw new ValidationError(`invalid function_name: ${value}`);
	}
	return value as Pox4FunctionName;
}

function bumpCursor(blockHeight: number, txIndex: number): RawBuilder<unknown> {
	return sql`
		(
			block_height > ${blockHeight}
			OR (
				block_height = ${blockHeight}
				AND tx_index > ${txIndex}
			)
		)
	`;
}

// ── /v1/datasets/pox-4/calls ───────────────────────────────────────

export type Pox4CallRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: Pox4FunctionName;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr_version: number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: number | null;
	end_cycle: number | null;
	signer_key: string | null;
	signer_signature: string | null;
	auth_id: string | null;
	max_amount: string | null;
	reward_cycle: number | null;
	aggregated_amount_ustx: string | null;
	aggregated_signer_index: number | null;
	auth_period: number | null;
	auth_topic: string | null;
	auth_allowed: boolean | null;
	result_ok: boolean;
};

export type Pox4CallsQuery = {
	cursor?: { block_height: number; tx_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	functionName?: Pox4FunctionName;
	stacker?: string;
	delegateTo?: string;
	signerKey?: string;
	rewardCycle?: number;
};

export function parsePox4CallsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): Pox4CallsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}

	const cursor = cursorRaw ? parsePox4Cursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(
		0,
		tip.block_height - STREAMS_BLOCKS_PER_DAY,
	);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;

	const rewardCycleRaw = query.get("reward_cycle");
	const rewardCycle =
		rewardCycleRaw !== null
			? parseNonNegativeInteger(rewardCycleRaw, "reward_cycle")
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		functionName: parseFunctionName(query.get("function_name") ?? undefined),
		stacker: parseFilter(query.get("stacker") ?? undefined, "stacker"),
		delegateTo: parseFilter(
			query.get("delegate_to") ?? undefined,
			"delegate_to",
		),
		signerKey: parseFilter(query.get("signer_key") ?? undefined, "signer_key"),
		rewardCycle,
	};
}

type Pox4CallDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	burn_block_height: string | number;
	tx_id: string;
	tx_index: string | number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: string | number | null;
	pox_addr_version: string | number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: string | number | null;
	end_cycle: string | number | null;
	signer_key: string | null;
	signer_signature: string | null;
	auth_id: string | null;
	max_amount: string | null;
	reward_cycle: string | number | null;
	aggregated_amount_ustx: string | null;
	aggregated_signer_index: string | number | null;
	auth_period: string | number | null;
	auth_topic: string | null;
	auth_allowed: boolean | null;
	result_ok: boolean;
};

function num(value: string | number | null): number | null {
	if (value === null) return null;
	return Number(value);
}

function normalizePox4Row(row: Pox4CallDbRow): Pox4CallRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		burn_block_height: Number(row.burn_block_height),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		function_name: row.function_name as Pox4FunctionName,
		caller: row.caller,
		stacker: row.stacker,
		delegate_to: row.delegate_to,
		amount_ustx: row.amount_ustx,
		lock_period: num(row.lock_period),
		pox_addr_version: num(row.pox_addr_version),
		pox_addr_hashbytes: row.pox_addr_hashbytes,
		pox_addr_btc: row.pox_addr_btc,
		start_cycle: num(row.start_cycle),
		end_cycle: num(row.end_cycle),
		signer_key: row.signer_key,
		signer_signature: row.signer_signature,
		auth_id: row.auth_id,
		max_amount: row.max_amount,
		reward_cycle: num(row.reward_cycle),
		aggregated_amount_ustx: row.aggregated_amount_ustx,
		aggregated_signer_index: num(row.aggregated_signer_index),
		auth_period: num(row.auth_period),
		auth_topic: row.auth_topic,
		auth_allowed: row.auth_allowed,
		result_ok: row.result_ok,
	};
}

export type ReadPox4CallsParams = {
	after?: { block_height: number; tx_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	functionName?: Pox4FunctionName;
	stacker?: string;
	delegateTo?: string;
	signerKey?: string;
	rewardCycle?: number;
	db?: Kysely<Database>;
};

export type ReadPox4CallsResult = {
	calls: Pox4CallRow[];
	next_cursor: string | null;
};

export type Pox4CallsReader = (
	params: ReadPox4CallsParams,
) => Promise<ReadPox4CallsResult>;

export async function readPox4Calls(
	params: ReadPox4CallsParams,
): Promise<ReadPox4CallsResult> {
	if (params.toBlock < params.fromBlock) {
		return { calls: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.functionName) {
		predicates.push(sql`function_name = ${params.functionName}`);
	}
	if (params.stacker) predicates.push(sql`stacker = ${params.stacker}`);
	if (params.delegateTo) {
		predicates.push(sql`delegate_to = ${params.delegateTo}`);
	}
	if (params.signerKey) predicates.push(sql`signer_key = ${params.signerKey}`);
	if (params.rewardCycle !== undefined) {
		predicates.push(sql`reward_cycle = ${params.rewardCycle}`);
	}
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.tx_index),
		);
	}

	const { rows } = await sql<Pox4CallDbRow>`
		SELECT
			cursor, block_height, block_time, burn_block_height, tx_id, tx_index,
			function_name, caller, stacker, delegate_to, amount_ustx, lock_period,
			pox_addr_version, pox_addr_hashbytes, pox_addr_btc,
			start_cycle, end_cycle, signer_key, signer_signature,
			auth_id, max_amount, reward_cycle,
			aggregated_amount_ustx, aggregated_signer_index,
			auth_period, auth_topic, auth_allowed, result_ok
		FROM pox4_calls
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, tx_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const calls = pageRows.map(normalizePox4Row);
	const last = calls.at(-1);
	return {
		calls,
		next_cursor: last ? `${last.block_height}:${last.tx_index}` : null,
	};
}

export async function getPox4CallsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	readCalls?: Pox4CallsReader;
}): Promise<{
	calls: Pox4CallRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parsePox4CallsQuery(opts.query, opts.tip);
	const reader = opts.readCalls ?? readPox4Calls;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		functionName: parsed.functionName,
		stacker: parsed.stacker,
		delegateTo: parsed.delegateTo,
		signerKey: parsed.signerKey,
		rewardCycle: parsed.rewardCycle,
	});
	return {
		calls: result.calls,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
