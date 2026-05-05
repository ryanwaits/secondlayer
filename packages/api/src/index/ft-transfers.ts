import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { decodeStreamsCursor } from "../streams/cursor.ts";
import {
	EMPTY_STREAMS_REORGS_READER,
	type StreamsReorg,
	type StreamsReorgsReader,
} from "../streams/reorgs.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import type { IndexTip } from "./tip.ts";

export type IndexCursorInput = {
	block_height: number;
	event_index: number;
};

export type FtTransferEvent = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};

export type FtTransfersQuery = {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	sender?: string;
	recipient?: string;
	cursorPastTip: boolean;
};

export type FtTransfersResponse = {
	events: FtTransferEvent[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
};

export type ReadFtTransfersParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	sender?: string;
	recipient?: string;
	db?: Kysely<Database>;
};

export type ReadFtTransfersResult = {
	events: FtTransferEvent[];
	next_cursor: string | null;
};

export type FtTransfersReader = (
	params: ReadFtTransfersParams,
) => Promise<ReadFtTransfersResult>;

type FtTransferRow = {
	cursor: string;
	block_height: string | number;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	event_type: "ft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};

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

function parseCursor(value: string): IndexCursorInput {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
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

export function parseFtTransfersQuery(
	query: URLSearchParams,
	tip: IndexTip,
): FtTransfersQuery {
	const cursorParamRaw = query.get("cursor") ?? undefined;
	const fromCursorRaw = query.get("from_cursor") ?? undefined;
	if (cursorParamRaw !== undefined && fromCursorRaw !== undefined) {
		throw new ValidationError("cursor and from_cursor are mutually exclusive");
	}

	const cursorRaw = fromCursorRaw ?? cursorParamRaw;
	const fromHeightRaw = query.get("from_height") ?? undefined;

	if (cursorRaw && fromHeightRaw !== undefined) {
		throw new ValidationError("cursor and from_height are mutually exclusive");
	}

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const requestedFromHeight =
		fromHeightRaw !== undefined
			? parseNonNegativeInteger(fromHeightRaw, "from_height")
			: undefined;
	const requestedToHeight =
		query.get("to_height") !== null
			? parseNonNegativeInteger(query.get("to_height") as string, "to_height")
			: undefined;
	const defaultFromHeight =
		cursorRaw === undefined && fromHeightRaw === undefined
			? Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY)
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: requestedFromHeight ?? defaultFromHeight ?? 0,
		toHeight:
			requestedToHeight === undefined
				? tip.block_height
				: Math.min(requestedToHeight, tip.block_height),
		limit: parseLimit(query.get("limit") ?? undefined),
		contractId: parseFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseFilter(query.get("recipient") ?? undefined, "recipient"),
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

function normalizeRow(row: FtTransferRow): FtTransferEvent {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		event_type: row.event_type,
		contract_id: row.contract_id,
		asset_identifier: row.asset_identifier,
		sender: row.sender,
		recipient: row.recipient,
		amount: row.amount,
	};
}

export function encodeIndexCursor(cursor: IndexCursorInput): string {
	return `${cursor.block_height}:${cursor.event_index}`;
}

export async function readFtTransfers(
	params: ReadFtTransfersParams,
): Promise<ReadFtTransfersResult> {
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`event_type = 'ft_transfer'`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
		sql`contract_id IS NOT NULL`,
		sql`asset_identifier IS NOT NULL`,
		sql`sender IS NOT NULL`,
		sql`recipient IS NOT NULL`,
		sql`amount IS NOT NULL`,
	];

	if (params.after) {
		predicates.push(sql`
			(
				block_height > ${params.after.block_height}
				OR (
					block_height = ${params.after.block_height}
					AND event_index > ${params.after.event_index}
				)
			)
		`);
	}

	if (params.contractId) {
		predicates.push(sql`contract_id = ${params.contractId}`);
	}
	if (params.sender) {
		predicates.push(sql`sender = ${params.sender}`);
	}
	if (params.recipient) {
		predicates.push(sql`recipient = ${params.recipient}`);
	}
	const orderBy = params.contractId
		? sql`contract_id ASC, block_height ASC, event_index ASC`
		: params.sender
			? sql`sender ASC, block_height ASC, event_index ASC`
			: params.recipient
				? sql`recipient ASC, block_height ASC, event_index ASC`
				: sql`block_height ASC, event_index ASC`;

	const { rows } = await sql<FtTransferRow>`
		SELECT
			cursor,
			block_height,
			tx_id,
			tx_index,
			event_index,
			event_type,
			contract_id,
			asset_identifier,
			sender,
			recipient,
			amount
		FROM decoded_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY ${orderBy}
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeRow);
	const lastEvent = events.at(-1);

	return {
		events,
		next_cursor: lastEvent
			? encodeIndexCursor({
					block_height: lastEvent.block_height,
					event_index: lastEvent.event_index,
				})
			: null,
	};
}

export async function getFtTransfersResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readTransfers?: FtTransfersReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<FtTransfersResponse> {
	const parsed = parseFtTransfersQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const readTransfers = opts.readTransfers ?? readFtTransfers;
	const result = await readTransfers({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		contractId: parsed.contractId,
		sender: parsed.sender,
		recipient: parsed.recipient,
	});
	const readReorgs = opts.readReorgs ?? EMPTY_STREAMS_REORGS_READER;
	const firstEvent = result.events.at(0);
	const lastEvent = result.events.at(-1);
	const reorgs =
		firstEvent && lastEvent
			? await readReorgs({
					from: {
						block_height: firstEvent.block_height,
						event_index: firstEvent.event_index,
					},
					to: {
						block_height: lastEvent.block_height,
						event_index: lastEvent.event_index,
					},
				})
			: [];

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
