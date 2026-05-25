import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsReorg, StreamsReorgsReader } from "../streams/reorgs.ts";
import {
	type IndexCursorInput,
	parseFilter,
	parseIndexBaseQuery,
	readReorgsForEvents,
} from "./_shared.ts";
import { readIndexEvents } from "./events.ts";
import type { IndexTip } from "./tip.ts";

export type { IndexCursorInput };

export type FtTransferEvent = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
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

export function parseFtTransfersQuery(
	query: URLSearchParams,
	tip: IndexTip,
): FtTransfersQuery {
	return {
		...parseIndexBaseQuery(query, tip),
		contractId: parseFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseFilter(query.get("recipient") ?? undefined, "recipient"),
	};
}

export async function readFtTransfers(
	params: ReadFtTransfersParams,
): Promise<ReadFtTransfersResult> {
	const filters: Partial<
		Record<"contract_id" | "sender" | "recipient", string>
	> = {};
	if (params.contractId) filters.contract_id = params.contractId;
	if (params.sender) filters.sender = params.sender;
	if (params.recipient) filters.recipient = params.recipient;

	const result = await readIndexEvents({
		eventType: "ft_transfer",
		after: params.after,
		fromHeight: params.fromHeight,
		toHeight: params.toHeight,
		limit: params.limit,
		filters,
		db: params.db,
	});

	return {
		events: result.events as FtTransferEvent[],
		next_cursor: result.next_cursor,
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
	const reorgs = await readReorgsForEvents(result.events, opts.readReorgs);

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
