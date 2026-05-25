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

export type NftTransferEvent = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: string;
};

export type NftTransfersQuery = {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	cursorPastTip: boolean;
};

export type NftTransfersResponse = {
	events: NftTransferEvent[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
};

export type ReadNftTransfersParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	db?: Kysely<Database>;
};

export type ReadNftTransfersResult = {
	events: NftTransferEvent[];
	next_cursor: string | null;
};

export type NftTransfersReader = (
	params: ReadNftTransfersParams,
) => Promise<ReadNftTransfersResult>;

export function parseNftTransfersQuery(
	query: URLSearchParams,
	tip: IndexTip,
): NftTransfersQuery {
	return {
		...parseIndexBaseQuery(query, tip),
		contractId: parseFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		assetIdentifier: parseFilter(
			query.get("asset_identifier") ?? undefined,
			"asset_identifier",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseFilter(query.get("recipient") ?? undefined, "recipient"),
	};
}

export async function readNftTransfers(
	params: ReadNftTransfersParams,
): Promise<ReadNftTransfersResult> {
	const filters: Partial<
		Record<"contract_id" | "asset_identifier" | "sender" | "recipient", string>
	> = {};
	if (params.contractId) filters.contract_id = params.contractId;
	if (params.assetIdentifier) filters.asset_identifier = params.assetIdentifier;
	if (params.sender) filters.sender = params.sender;
	if (params.recipient) filters.recipient = params.recipient;

	const result = await readIndexEvents({
		eventType: "nft_transfer",
		after: params.after,
		fromHeight: params.fromHeight,
		toHeight: params.toHeight,
		limit: params.limit,
		filters,
		db: params.db,
	});

	return {
		events: result.events as NftTransferEvent[],
		next_cursor: result.next_cursor,
	};
}

export async function getNftTransfersResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readTransfers?: NftTransfersReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<NftTransfersResponse> {
	const parsed = parseNftTransfersQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const readTransfers = opts.readTransfers ?? readNftTransfers;
	const result = await readTransfers({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		contractId: parsed.contractId,
		assetIdentifier: parsed.assetIdentifier,
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
