import {
	decodedRow,
	parseAssetIdentifier,
	requireAmount,
	requireString,
} from "./_payload.ts";
import type { StreamsEvent } from "./types.ts";

export type { FtTransferPayload } from "./types.ts";

export type FtTransferEvent = Extract<
	StreamsEvent,
	{ event_type: "ft_transfer" }
>;

export type DecodedFtTransferPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	sender: string;
	recipient: string;
	amount: string;
};

export type DecodedFtTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_transfer";
	decoded_payload: DecodedFtTransferPayload;
	source_cursor: string;
};

export function isFtTransfer(event: StreamsEvent): event is FtTransferEvent {
	return event.event_type === "ft_transfer";
}

export function decodeFtTransfer(event: StreamsEvent): DecodedFtTransfer {
	if (!isFtTransfer(event)) {
		throw new Error(`Expected ft_transfer event, got ${event.event_type}`);
	}

	const payload = event.payload;
	const assetIdentifier = requireString(
		payload,
		"asset_identifier",
		"ft_transfer",
	);
	const sender = requireString(payload, "sender", "ft_transfer");
	const recipient = requireString(payload, "recipient", "ft_transfer");
	const amount = requireAmount(payload, "ft_transfer");
	const { contract_id, token_name } = parseAssetIdentifier(
		assetIdentifier,
		"ft_transfer",
	);

	return decodedRow(event, "ft_transfer", {
		asset_identifier: assetIdentifier,
		contract_id: event.contract_id ?? contract_id,
		token_name,
		sender,
		recipient,
		amount,
	});
}
